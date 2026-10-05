import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../http/errors.js';
import type { WebStaff } from './access.js';

const randomToken = () => randomBytes(32).toString('base64url');
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const SESSION_MS = 8 * 60 * 60_000;
const IDLE_MS = 30 * 60_000;
const LOGIN_MS = 5 * 60_000;

export interface WebConfig {
  url: string;
  clientId: string;
  clientSecret: string;
}

export function loadWebConfig(read: (name: string, fallback: string) => string): WebConfig | null {
  const url = read('simpleac:web_url', '').trim().replace(/\/$/, '');
  if (!url) return null;
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.endsWith('/panel')
  ) {
    throw new Error('simpleac:web_url must be an HTTPS URL ending in /panel');
  }
  const clientId = read('simpleac:discord_client_id', '').trim();
  const clientSecret = read('simpleac:discord_client_secret', '').trim();
  if (!/^\d{17,20}$/.test(clientId) || !clientSecret) {
    throw new Error('Discord client ID and client secret are required for the browser panel');
  }
  return { url, clientId, clientSecret };
}

const userSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1).max(128),
  global_name: z.string().max(128).nullable().optional(),
});

export function createDiscordLogin(config: WebConfig, request: typeof fetch = fetch) {
  return {
    authorize(state: string): string {
      const url = new URL('https://discord.com/oauth2/authorize');
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: `${config.url}/auth/callback`,
        response_type: 'code',
        scope: 'identify',
        state,
      }).toString();
      return url.href;
    },
    async exchange(code: string): Promise<Omit<WebStaff, 'sessionId'>> {
      const response = await request('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${config.url}/auth/callback`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new ApiError(401, 'unauthenticated', 'Discord sign-in failed.');
      const token = z
        .object({ access_token: z.string().min(1), token_type: z.literal('Bearer') })
        .parse(await response.json());
      const user = await request('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!user.ok)
        throw new ApiError(401, 'unauthenticated', 'Discord could not verify your identity.');
      const identity = userSchema.parse(await user.json());
      return {
        identifier: `discord:${identity.id}`,
        name: identity.global_name || identity.username,
      };
    },
  };
}

export type WebWatchEvent =
  | { type: 'offer'; id: string; sdp: string }
  | { type: 'ended'; id: string; reason: string };

export interface WebSession extends WebStaff {
  csrf: string;
  createdAt: number;
  touchedAt: number;
  polledAt: number | null;
  sequence: number;
  events: { sequence: number; event: WebWatchEvent }[];
}

export function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createWebSessions(
  options: { now?: () => number; onLeave?: (viewer: string) => Promise<void> } = {},
) {
  const now = options.now ?? Date.now;
  const sessions = new Map<string, WebSession>();
  const pending = new Map<string, { binding: string; expiresAt: number }>();
  const leave = (session: WebSession) => {
    void options.onLeave?.(`web:${session.sessionId}`).catch(() => undefined);
  };
  const prune = () => {
    const current = now();
    for (const [state, login] of pending) {
      if (login.expiresAt <= current) pending.delete(state);
    }
    for (const [id, session] of sessions) {
      if (session.createdAt + SESSION_MS <= current || session.touchedAt + IDLE_MS <= current) {
        sessions.delete(id);
        leave(session);
      } else if (session.polledAt !== null && session.polledAt + 30_000 <= current) {
        session.polledAt = null;
        leave(session);
      }
    }
  };
  return {
    prune,
    isActive(session: WebSession): boolean {
      prune();
      return sessions.has(session.sessionId);
    },
    async endWatch(session: WebSession) {
      session.polledAt = null;
      await options.onLeave?.(`web:${session.sessionId}`);
    },
    beginLogin() {
      prune();
      if (pending.size >= 1024)
        throw new ApiError(503, 'unavailable', 'Sign-in is busy. Try again later.');
      const state = randomToken();
      const binding = randomToken();
      pending.set(digest(state), { binding: digest(binding), expiresAt: now() + LOGIN_MS });
      return { state, binding };
    },
    consumeLogin(state: string, binding: string): boolean {
      prune();
      const login = pending.get(digest(state));
      if (!login || !sameToken(login.binding, digest(binding))) return false;
      pending.delete(digest(state));
      return true;
    },
    create(identity: Omit<WebStaff, 'sessionId'>) {
      prune();
      if (sessions.size >= 2048)
        throw new ApiError(503, 'unavailable', 'The panel is busy. Try again later.');
      const token = randomToken();
      const sessionId = digest(token);
      const session: WebSession = {
        ...identity,
        sessionId,
        csrf: randomToken(),
        createdAt: now(),
        touchedAt: now(),
        polledAt: null,
        sequence: 0,
        events: [],
      };
      sessions.set(sessionId, session);
      return { token, session };
    },
    get(token: string): WebSession | null {
      prune();
      const session = sessions.get(digest(token));
      if (!session) return null;
      session.touchedAt = now();
      return session;
    },
    async remove(token: string) {
      const id = digest(token);
      const session = sessions.get(id);
      if (!session) return;
      sessions.delete(id);
      await options.onLeave?.(`web:${id}`);
    },
    push(sessionId: string, event: WebWatchEvent) {
      const session = sessions.get(sessionId);
      if (!session) return;
      session.events.push({ sequence: ++session.sequence, event });
      session.events = session.events.slice(-32);
    },
    poll(session: WebSession, after: number) {
      session.polledAt = now();
      session.events = session.events.filter((item) => item.sequence > after);
      return { cursor: session.sequence, events: session.events };
    },
  };
}

export type WebSessions = ReturnType<typeof createWebSessions>;
