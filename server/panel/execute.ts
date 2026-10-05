import { type PanelOp, panelOps } from '../../shared/contracts/panel.js';
import { ApiError } from '../http/errors.js';
import type { StaffIdentity } from './access.js';
import { newCorrelationId, type PanelContext, type PanelHandlers, staffActor } from './handlers.js';

/** Largest request body, as JSON, whether it comes from the game or from the browser. */
export const MAX_PAYLOAD_CHARS = 32_768;

/**
 * An empty Lua table crosses the game boundary as an empty array, not an empty object, so an operation with no
 * input would otherwise fail validation.
 */
export function normalizePayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return {};
  if (Array.isArray(payload) && payload.length === 0) return {};
  return payload;
}

const isOp = (value: unknown): value is PanelOp =>
  typeof value === 'string' && Object.hasOwn(panelOps, value);

/**
 * The one place an operation is checked and run, for the game and for the browser alike: the operation must exist,
 * the body must be small, the staff member must hold its permission right now, and the input must match its schema.
 */
export async function executeOperation(
  handlers: PanelHandlers,
  staff: StaffIdentity,
  op: unknown,
  payload: unknown,
  onForbidden?: (op: PanelOp) => void,
): Promise<unknown> {
  if (!isOp(op)) throw new ApiError(400, 'bad_request', 'Unknown operation.');
  const body = normalizePayload(payload);
  if (JSON.stringify(body).length > MAX_PAYLOAD_CHARS) {
    throw new ApiError(413, 'payload_too_large', 'The request is too large.');
  }
  const definition = panelOps[op];
  if (!staff.permissions.has(definition.permission)) {
    onForbidden?.(op);
    throw new ApiError(403, 'forbidden', 'You do not have permission to do that.');
  }
  const parsed = definition.input.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'validation_failed', 'The request failed validation.', {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  const correlationId = newCorrelationId();
  const context: PanelContext = { staff, actor: staffActor(staff, correlationId), correlationId };
  const handler = handlers[op] as (context: PanelContext, input: unknown) => Promise<unknown>;
  return handler(context, parsed.data);
}
