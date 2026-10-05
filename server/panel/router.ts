import { ZodError } from 'zod';
import type { PanelReply, PanelSession } from '../../shared/contracts/panel.js';
import { ApiError } from '../http/errors.js';
import type { RateLimiter } from '../http/middleware/rate-limit.js';
import type { PanelAccess } from './access.js';
import { executeOperation } from './execute.js';
import { newCorrelationId, type PanelContext, type PanelHandlers, staffActor } from './handlers.js';

/** Replies larger than this travel as latent events so they do not flood the connection. */
const LATENT_THRESHOLD_CHARS = 16_000;
const LATENT_BYTES_PER_SECOND = 1_048_576;

export interface PanelTransport {
  /** Delivers a reply to one player. `latent` asks for bandwidth-limited delivery. */
  reply(source: number, reply: PanelReply, latent: boolean): void;
  granted(source: number, session: PanelSession): void;
  denied(source: number): void;
}

export interface PanelRouterDeps {
  access: PanelAccess;
  handlers: PanelHandlers;
  limiter: RateLimiter;
  transport: PanelTransport;
  /** Builds the session shown when the panel opens. */
  session(staff: Awaited<ReturnType<PanelAccess['resolve']>>): Promise<PanelSession>;
  /** Records that the panel was opened. */
  audit(context: PanelContext): Promise<void>;
  log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>): void;
}

export interface PanelRouter {
  open(source: number): Promise<void>;
  request(source: number, id: unknown, op: unknown, payload: unknown): Promise<void>;
}

function failure(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof ZodError) {
    return { code: 'validation_failed', message: 'The request failed validation.' };
  }
  return { code: 'internal_error', message: 'The request could not be completed.' };
}

export function createPanelRouter(deps: PanelRouterDeps): PanelRouter {
  const { access, handlers, limiter, transport } = deps;

  const send = (source: number, reply: PanelReply): void => {
    const size = reply.ok ? JSON.stringify(reply.data ?? null).length : 0;
    transport.reply(source, reply, size > LATENT_THRESHOLD_CHARS);
  };

  return {
    async open(source) {
      if (limiter.take(`open:${String(source)}`) > 0) return;
      try {
        const staff = await access.resolve(source);
        if (staff.permissions.size === 0) {
          deps.log('warn', 'panel_denied', { source });
          transport.denied(source);
          return;
        }
        const correlationId = newCorrelationId();
        await deps.audit({ staff, actor: staffActor(staff, correlationId), correlationId });
        transport.granted(source, await deps.session(staff));
      } catch (error: unknown) {
        deps.log('error', 'panel_open_failed', {
          source,
          error: error instanceof Error ? error.message : 'unknown error',
        });
        transport.denied(source);
      }
    },

    async request(source, id, op, payload) {
      // A reply needs an ID to be matched on the other side; without one there is nobody to answer.
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 2_147_483_647) return;
      if (limiter.take(`req:${String(source)}`) > 0) {
        send(source, { id, ok: false, code: 'rate_limited', message: 'Slow down for a moment.' });
        return;
      }
      try {
        const staff = await access.resolve(source);
        const data = await executeOperation(handlers, staff, op, payload, (denied) => {
          deps.log('warn', 'panel_forbidden', { source, op: denied });
        });
        send(source, { id, ok: true, data });
      } catch (error: unknown) {
        const mapped = failure(error);
        if (mapped.code === 'internal_error') {
          deps.log('error', 'panel_request_failed', {
            source,
            op: typeof op === 'string' ? op : 'unknown',
            error: error instanceof Error ? error.message : 'unknown error',
          });
        }
        send(source, { id, ok: false, ...mapped });
      }
    },
  };
}

export { LATENT_BYTES_PER_SECOND };
