import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Koa from 'koa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '../../server/http/middleware/errors.js';
import { securityMiddleware } from '../../server/http/middleware/security.js';
import { createWebPanelRouter, type WebPanelDeps } from '../../server/http/routes/panel.js';
import type { PanelContext, PanelHandlers } from '../../server/panel/handlers.js';
import {
  createDiscordLogin,
  createWebSessions,
  loadWebConfig,
} from '../../server/panel/web-auth.js';
import type { PanelPermission } from '../../shared/contracts/panel.js';

const ID = '123456789012345678';
const identity = { identifier: `discord:${ID}`, name: 'Browser Staff' };
const config = {
  url: 'https://ac.example/simpleac/panel',
  clientId: ID,
  clientSecret: 'test-secret',
};

describe('browser authentication', () => {
  it('is disabled unless configured and requires HTTPS and complete Discord configuration', () => {
    expect(loadWebConfig((_name, fallback) => fallback)).toBeNull();
    expect(() =>
      loadWebConfig((name) => (name === 'simpleac:web_url' ? 'http://example.com/panel' : '')),
    ).toThrow('HTTPS');
    expect(() => loadWebConfig((name) => (name === 'simpleac:web_url' ? config.url : ''))).toThrow(
      'client ID',
    );
    expect(
      loadWebConfig(
        (name) =>
          ({
            'simpleac:web_url': config.url,
            'simpleac:discord_client_id': ID,
            'simpleac:discord_client_secret': config.clientSecret,
          })[name] ?? '',
      ),
    ).toEqual(config);
  });

  it('binds OAuth state to the initiating browser and accepts it only once', () => {
    let now = 0;
    const sessions = createWebSessions({ now: () => now });
    const first = sessions.beginLogin();
    const other = sessions.beginLogin();
    expect(sessions.consumeLogin(first.state, other.binding)).toBe(false);
    expect(sessions.consumeLogin(first.state, first.binding)).toBe(true);
    expect(sessions.consumeLogin(first.state, first.binding)).toBe(false);
    now = 5 * 60_000;
    expect(sessions.consumeLogin(other.state, other.binding)).toBe(false);
  });

  it('expires idle sessions, imposes an absolute lifetime and closes their viewers', async () => {
    let now = 0;
    const onLeave = vi.fn(() => Promise.resolve());
    const sessions = createWebSessions({ now: () => now, onLeave });
    const first = sessions.create(identity);
    expect(first.session.sessionId).not.toBe(first.token);
    expect(sessions.get('forged')).toBeNull();
    now = 30 * 60_000;
    expect(sessions.get(first.token)).toBeNull();
    expect(onLeave).toHaveBeenCalledWith(`web:${first.session.sessionId}`);
    const second = sessions.create(identity);
    for (let index = 0; index < 16; index++) {
      now += 29 * 60_000;
      expect(sessions.get(second.token)).not.toBeNull();
    }
    now += 16 * 60_000;
    expect(sessions.get(second.token)).toBeNull();
    const third = sessions.create(identity);
    await sessions.remove(third.token);
    expect(sessions.get(third.token)).toBeNull();
  });

  it('isolates signals per viewer, supports replay until acknowledged and stops absent viewers', () => {
    let now = 0;
    const onLeave = vi.fn(() => Promise.resolve());
    const sessions = createWebSessions({ now: () => now, onLeave });
    const a = sessions.create(identity).session;
    const b = sessions.create(identity).session;
    sessions.push(a.sessionId, { type: 'offer', id: 'watch', sdp: 'offer' });
    expect(sessions.poll(b, 0).events).toEqual([]);
    expect(sessions.poll(a, 0).events).toHaveLength(1);
    expect(sessions.poll(a, 0).events).toHaveLength(1);
    expect(sessions.poll(a, 1).events).toEqual([]);
    now = 30_001;
    sessions.prune();
    expect(onLeave).toHaveBeenCalledWith(`web:${a.sessionId}`);
  });

  it('exchanges codes server-side using identify and derives identity from Discord', async () => {
    const request = vi.fn<typeof fetch>();
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'private-token', token_type: 'Bearer' })),
    );
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: ID, username: 'staff', global_name: 'Display Name' })),
    );
    const login = createDiscordLogin(config, request);
    const authorize = new URL(login.authorize('random-state'));
    expect(authorize.searchParams.get('scope')).toBe('identify');
    expect(authorize.searchParams.get('state')).toBe('random-state');
    expect(await login.exchange('code')).toEqual({
      identifier: `discord:${ID}`,
      name: 'Display Name',
    });
    const body = request.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get('client_secret')).toBe(config.clientSecret);
    expect((body as URLSearchParams).get('redirect_uri')).toBe(`${config.url}/auth/callback`);
    expect(request.mock.calls[1]?.[1]?.headers).toEqual({ authorization: 'Bearer private-token' });
  });
});

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function setup() {
  let permissions: PanelPermission[] = ['players.view', 'live.watch'];
  const onLeave = vi.fn(() => Promise.resolve());
  const sessions = createWebSessions({ onLeave });
  const audit = vi.fn(() => Promise.resolve());
  const exchange = vi.fn(async () => identity);
  const overview = vi.fn(async (_context: PanelContext) => ({ online: 1 }));
  const assetsDirectory = mkdtempSync(join(tmpdir(), 'simpleac-panel-test-'));
  directories.push(assetsDirectory);
  mkdirSync(join(assetsDirectory, 'assets'));
  writeFileSync(join(assetsDirectory, 'index.html'), '<html>panel</html>');
  writeFileSync(join(assetsDirectory, 'assets', 'panel.js'), 'window.panel=true;');
  const deps: WebPanelDeps = {
    config,
    sessions,
    assetsDirectory,
    audit,
    handlers: { 'overview.get': overview } as unknown as PanelHandlers,
    access: {
      resolve: () => Promise.reject(new Error('unused')),
      resolveWeb: async (web) => ({
        ...identity,
        source: 0,
        viewer: `web:${web.sessionId}`,
        via: 'web',
        identifiers: [web.identifier],
        playerId: null,
        permissions: new Set(permissions),
      }),
    },
    session: async (staff) => ({
      staff: {
        name: staff.name,
        source: 0,
        playerId: null,
        permissions: [...staff.permissions],
        bypass: false,
      },
      server: {
        name: 'Test',
        online: 1,
        slots: 48,
        uptimeSeconds: 1,
        version: 'test',
        profile: null,
      },
    }),
    discord: {
      authorize: (state) => `https://discord.com/oauth2/authorize?state=${state}`,
      exchange,
    },
  };
  const app = new Koa();
  app.use(errorMiddleware);
  app.use(securityMiddleware);
  const router = createWebPanelRouter(deps);
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = createServer(app.callback());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, options: RequestInit = {}) =>
    fetch(`${base}/panel${path}`, { redirect: 'manual', ...options });
  const signin = async () => {
    const login = await request('/auth/login');
    const binding = login.headers.getSetCookie()[0]?.split(';')[0] ?? '';
    const state = new URL(login.headers.get('location') ?? '').searchParams.get('state');
    const callback = await request(`/auth/callback?state=${state}&code=valid`, {
      headers: { cookie: binding },
    });
    const cookie =
      callback.headers
        .getSetCookie()
        .find((value) => value.startsWith('simpleac_session_'))
        ?.split(';')[0] ?? '';
    return { callback, cookie, state, binding };
  };
  return {
    request,
    signin,
    sessions,
    overview,
    onLeave,
    exchange,
    audit,
    revoke: () => {
      permissions = [];
    },
    revokeWatch: () => {
      permissions = ['players.view'];
    },
  };
}

describe('browser panel HTTP', () => {
  it('cleans up an operation that completes after its session was removed', async () => {
    const { signin, request, sessions, overview, onLeave } = await setup();
    const { cookie } = await signin();
    const { csrf } = (await (await request('/session', { headers: { cookie } })).json()) as {
      csrf: string;
    };
    overview.mockImplementationOnce(async () => {
      await sessions.remove(cookie.slice(cookie.indexOf('=') + 1));
      return { online: 1 };
    });
    const response = await request('/rpc', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://ac.example',
        'content-type': 'application/json',
        'x-simpleac-csrf': csrf,
      },
      body: JSON.stringify({ op: 'overview.get', payload: {} }),
    });
    expect(response.status).toBe(200);
    expect(onLeave).toHaveBeenCalledTimes(2);
    expect((await request('/session', { headers: { cookie } })).status).toBe(401);
  });
  it('serves assets with a page CSP and prevents traversal or source disclosure', async () => {
    const { request } = await setup();
    const page = await request('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await page.text()).toContain('panel');
    const asset = await request('/assets/panel.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect((await request('/assets/%2e%2e%2findex.html')).status).toBe(404);
    expect((await request('/web-auth.ts')).status).toBe(404);
    expect((await request('/session')).status).toBe(401);
  });

  it('uses secure HTTP-only scoped cookies and rejects callback replay before exchange', async () => {
    const { signin, request, exchange, audit } = await setup();
    const { callback, cookie, state, binding } = await signin();
    expect(callback.status).toBe(302);
    const setCookie =
      callback.headers.getSetCookie().find((value) => value.startsWith('simpleac_session_')) ?? '';
    expect(setCookie).toMatch(/httponly/i);
    expect(setCookie).toMatch(/secure/i);
    expect(setCookie).toMatch(/samesite=lax/i);
    expect(setCookie).toContain('path=/simpleac/panel');
    expect(cookie).not.toContain(config.clientSecret);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(
      (
        await request(`/auth/callback?state=${state}&code=valid`, { headers: { cookie: binding } })
      ).headers.get('location'),
    ).toContain('login=failed');
    expect(exchange).toHaveBeenCalledTimes(1);
    const session = await request('/session', { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(JSON.stringify(await session.json())).not.toContain('private-token');
  });

  it('requires origin and CSRF, validates operations and rechecks permissions', async () => {
    const { signin, request, overview, revoke, onLeave } = await setup();
    const { cookie } = await signin();
    const bootstrap = (await (await request('/session', { headers: { cookie } })).json()) as {
      csrf: string;
    };
    const body = JSON.stringify({ op: 'overview.get', payload: {} });
    const headers = {
      cookie,
      origin: 'https://ac.example',
      'content-type': 'application/json',
      'x-simpleac-csrf': bootstrap.csrf,
    };
    expect(
      (
        await request('/rpc', {
          method: 'POST',
          headers: { ...headers, origin: 'https://attacker.example' },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/rpc', {
          method: 'POST',
          headers: { ...headers, 'x-simpleac-csrf': '' },
          body,
        })
      ).status,
    ).toBe(403);
    expect(overview).not.toHaveBeenCalled();
    expect((await request('/rpc', { method: 'POST', headers, body })).status).toBe(200);
    expect(overview.mock.calls[0]?.[0]).toMatchObject({
      staff: { via: 'web' },
      actor: { type: 'staff', origin: 'web_panel', keyId: identity.identifier },
    });
    expect(
      (
        await request('/rpc', {
          method: 'POST',
          headers,
          body: JSON.stringify({ op: 'moderation.kick', payload: {} }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await request('/rpc', { method: 'POST', headers, body: JSON.stringify({ op: 'not.real' }) }))
        .status,
    ).toBe(400);
    expect(
      (
        await request('/rpc', {
          method: 'POST',
          headers,
          body: JSON.stringify({ op: 'overview.get', payload: { huge: 'x'.repeat(33_000) } }),
        })
      ).status,
    ).toBe(413);
    revoke();
    expect((await request('/session', { headers: { cookie } })).status).toBe(403);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect((await request('/session', { headers: { cookie } })).status).toBe(401);
  });

  it('ends a browser viewer on logout and on live-watch permission revocation', async () => {
    const { signin, request, onLeave, revokeWatch } = await setup();
    const { cookie } = await signin();
    const bootstrap = (await (await request('/session', { headers: { cookie } })).json()) as {
      csrf: string;
    };
    revokeWatch();
    expect((await request('/events', { headers: { cookie } })).status).toBe(200);
    expect(onLeave).toHaveBeenCalledTimes(1);
    const logout = await request('/auth/logout', {
      method: 'POST',
      headers: { cookie, origin: 'https://ac.example', 'x-simpleac-csrf': bootstrap.csrf },
    });
    expect(logout.status).toBe(200);
    expect((await request('/session', { headers: { cookie } })).status).toBe(401);
  });

  it('refuses Discord users with no staff grant without issuing a session', async () => {
    const { signin, revoke } = await setup();
    revoke();
    const { callback, cookie } = await signin();
    expect(callback.headers.get('location')).toContain('login=denied');
    expect(cookie).toBe('');
  });
});
