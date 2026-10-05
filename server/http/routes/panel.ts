import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Router from '@koa/router';
import type { Middleware } from 'koa';
import { z } from 'zod';
import type { PanelSession } from '../../../shared/contracts/panel.js';
import type { PanelAccess, StaffIdentity } from '../../panel/access.js';
import { executeOperation } from '../../panel/execute.js';
import type { PanelHandlers } from '../../panel/handlers.js';
import {
  createDiscordLogin,
  sameToken,
  type WebConfig,
  type WebSession,
  type WebSessions,
} from '../../panel/web-auth.js';
import { ApiError } from '../errors.js';
import { jsonBodyMiddleware } from '../middleware/body.js';
import { createRateLimiter, rateLimited } from '../middleware/rate-limit.js';
import type { HttpState } from '../types.js';

export interface WebPanelDeps {
  config: WebConfig;
  sessions: WebSessions;
  access: PanelAccess;
  handlers: PanelHandlers;
  assetsDirectory: string;
  session(staff: StaffIdentity): Promise<PanelSession>;
  audit(staff: StaffIdentity, action: 'panel.opened' | 'panel.closed'): Promise<void>;
  discord?: ReturnType<typeof createDiscordLogin>;
}

type PanelState = HttpState & { webSession?: WebSession; staff?: StaffIdentity };
const inputSchema = z.object({ op: z.string().max(80), payload: z.unknown().optional() }).strict();
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function createWebPanelRouter(deps: WebPanelDeps) {
  const router = new Router<PanelState>({ prefix: '/panel' });
  const discord = deps.discord ?? createDiscordLogin(deps.config);
  const publicUrl = new URL(deps.config.url);
  const cookiePath = publicUrl.pathname;
  const suffix = createCookieSuffix(deps.config.url);
  const cookie = `simpleac_session_${suffix}`;
  const loginCookie = `simpleac_login_${suffix}`;
  const loginLimiter = createRateLimiter(10, 10 / 60);
  const operationLimiter = createRateLimiter(30, 15);
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    signed: false,
    overwrite: true,
    path: cookiePath,
  };
  router.use(async (context, next) => {
    context.cookies.secure = true;
    await next();
  });
  const authenticate: Middleware<PanelState> = async (context, next) => {
    const session = deps.sessions.get(context.cookies.get(cookie, { signed: false }) ?? '');
    if (!session) throw new ApiError(401, 'unauthenticated', 'Sign in to the panel.');
    const retry = operationLimiter.take(session.identifier);
    if (retry) throw rateLimited(retry);
    const staff = await deps.access.resolveWeb(session);
    if (staff.permissions.size === 0) {
      await deps.sessions.remove(context.cookies.get(cookie, { signed: false }) ?? '');
      throw new ApiError(403, 'forbidden', 'You do not have panel access on this server.');
    }
    context.state.webSession = session;
    context.state.staff = staff;
    await next();
  };
  const csrf: Middleware<PanelState> = async (context, next) => {
    if (
      context.get('origin') !== publicUrl.origin ||
      !sameToken(context.get('x-simpleac-csrf'), context.state.webSession?.csrf ?? 'invalid')
    ) {
      throw new ApiError(403, 'forbidden', 'The request could not be verified. Reload the panel.');
    }
    await next();
  };
  router.get('/auth/login', (context) => {
    const retry = loginLimiter.take(context.ip);
    if (retry) throw rateLimited(retry);
    const { state, binding } = deps.sessions.beginLogin();
    context.cookies.set(loginCookie, binding, { ...cookieOptions, maxAge: 5 * 60_000 });
    context.redirect(discord.authorize(state));
  });
  router.get('/auth/callback', async (context) => {
    const retry = loginLimiter.take(context.ip);
    if (retry) throw rateLimited(retry);
    const state = z.string().min(1).max(128).safeParse(context.query['state']);
    const binding = context.cookies.get(loginCookie, { signed: false }) ?? '';
    context.cookies.set(loginCookie, null, cookieOptions);
    if (!state.success || !deps.sessions.consumeLogin(state.data, binding)) {
      context.redirect(`${deps.config.url}/?login=failed`);
      return;
    }
    const code = z.string().min(1).max(2048).safeParse(context.query['code']);
    if (!code.success) {
      context.redirect(`${deps.config.url}/?login=failed`);
      return;
    }
    let identity: Awaited<ReturnType<typeof discord.exchange>>;
    try {
      identity = await discord.exchange(code.data);
    } catch {
      context.redirect(`${deps.config.url}/?login=failed`);
      return;
    }
    const staff = await deps.access.resolveWeb({ ...identity, sessionId: 'login' });
    if (staff.permissions.size === 0) {
      context.redirect(`${deps.config.url}/?login=denied`);
      return;
    }
    await deps.audit(staff, 'panel.opened');
    await deps.sessions.remove(context.cookies.get(cookie, { signed: false }) ?? '');
    const { token } = deps.sessions.create(identity);
    context.cookies.set(cookie, token, { ...cookieOptions, maxAge: 8 * 60 * 60_000 });
    context.redirect(`${deps.config.url}/`);
  });
  router.get('/session', authenticate, async (context) => {
    if (!context.state.staff || !context.state.webSession) throw new Error('Missing session');
    context.body = {
      session: await deps.session(context.state.staff),
      csrf: context.state.webSession.csrf,
    };
  });
  router.post('/rpc', authenticate, csrf, jsonBodyMiddleware, async (context) => {
    const input = inputSchema.safeParse(context.state.body);
    if (!input.success) throw new ApiError(400, 'bad_request', 'Invalid panel request.');
    if (!context.state.staff) throw new Error('Missing staff');
    const session = context.state.webSession;
    if (!session) throw new Error('Missing session');
    try {
      context.body = {
        data: await executeOperation(
          deps.handlers,
          context.state.staff,
          input.data.op,
          input.data.payload,
        ),
      };
    } finally {
      if (!deps.sessions.isActive(session)) await deps.sessions.endWatch(session);
    }
  });
  router.get('/events', authenticate, async (context) => {
    const after = z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .safeParse(context.query['after'] ?? 0);
    if (!after.success) throw new ApiError(400, 'bad_request', 'Invalid event cursor.');
    if (!context.state.webSession) throw new Error('Missing session');
    if (!context.state.staff?.permissions.has('live.watch'))
      await deps.sessions.endWatch(context.state.webSession);
    context.body = deps.sessions.poll(context.state.webSession, after.data);
  });
  router.post('/auth/logout', authenticate, csrf, async (context) => {
    if (!context.state.staff) throw new Error('Missing staff');
    await deps.audit(context.state.staff, 'panel.closed');
    await deps.sessions.remove(context.cookies.get(cookie, { signed: false }) ?? '');
    context.cookies.set(cookie, null, cookieOptions);
    context.body = { ok: true };
  });
  const staticFile: Middleware<PanelState> = async (context, next) => {
    const relative = context.path.slice('/panel'.length).replace(/^\//, '');
    if (!relative) {
      if (!context.path.endsWith('/')) {
        context.redirect(`${deps.config.url}/`);
        return;
      }
    } else if (
      !/^(assets|branding)\/[A-Za-z0-9._/-]+$/.test(relative) ||
      relative.split('/').includes('..')
    ) {
      await next();
      return;
    }
    const name = relative || 'index.html';
    const extension = name.slice(name.lastIndexOf('.'));
    if (!MIME[extension]) {
      await next();
      return;
    }
    try {
      context.body = await readFile(join(deps.assetsDirectory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await next();
      return;
    }
    context.type = MIME[extension];
    context.set(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  };
  router.get('/', staticFile);
  router.get('/{*path}', staticFile);
  return router;
}

function createCookieSuffix(url: string): string {
  return Buffer.from(new URL(url).pathname).toString('base64url');
}
