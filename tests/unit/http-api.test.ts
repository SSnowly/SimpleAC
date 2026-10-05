import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpApp } from '../../server/http/app.js';
import { createRateLimiter } from '../../server/http/middleware/rate-limit.js';
import type { ApiKeyService, VerifiedKey } from '../../server/services/api-keys.js';
import type { BanService } from '../../server/services/bans.js';
import type { CaseService } from '../../server/services/cases.js';
import type { DetectionService } from '../../server/services/detections.js';
import type { Directory } from '../../server/services/directory.js';
import type { ExceptionService } from '../../server/services/exceptions.js';
import type { IdempotencyBegin, IdempotencyStore } from '../../server/services/idempotency.js';
import type { OverviewService } from '../../server/services/overview.js';
import type { ProfileService } from '../../server/services/profiles.js';
import type { ApiScope, Ban } from '../../shared/contracts/api.js';

const PLAYER = 'SAC-PLY-01JABCDEFGHJKMNPQRSTVWXYZ0';
const OTHER_PLAYER = 'SAC-PLY-01JABCDEFGHJKMNPQRSTVWXYZ1';
const BAN = 'SAC-BAN-01JABCDEFGHJKMNPQRSTVWXYZ0';
const ACTION = 'SAC-ACT-01JABCDEFGHJKMNPQRSTVWXYZ0';
const NOW = '2026-01-01T00:00:00.000Z';

const tokens: Record<string, { scopes: ApiScope[]; allowedIps?: string[] }> = {
  admin: { scopes: ['admin'] },
  reader: { scopes: ['players:read'] },
  investigator: { scopes: ['players:read', 'identifiers:read'] },
  banner: { scopes: ['bans:write'] },
  locked: { scopes: ['admin'], allowedIps: ['203.0.113.9'] },
};

const keys: ApiKeyService = {
  create: () => Promise.reject(new Error('unused')),
  revoke: () => Promise.resolve(false),
  list: () => Promise.resolve([]),
  authenticate(token) {
    const entry = tokens[token.replace('sac_', '')];
    if (!entry) return Promise.resolve(null);
    const key: VerifiedKey = {
      id: `SAC-KEY-${token.toUpperCase()}`,
      name: token,
      scopes: entry.scopes,
      allowedIps: entry.allowedIps ?? [],
    };
    return Promise.resolve(key);
  },
};

const ban: Ban = {
  id: BAN as Ban['id'],
  playerId: PLAYER as Ban['playerId'],
  actionId: ACTION as Ban['actionId'],
  reason: 'test',
  expiresAt: null,
  revokedByActionId: null,
  active: true,
  createdAt: NOW,
};

let banCreations = 0;
const bans: BanService = {
  create() {
    banCreations += 1;
    return Promise.resolve(ban);
  },
  revoke: () => Promise.resolve({ ...ban, active: false }),
};

const directory: Directory = {
  listPlayers: () =>
    Promise.resolve({
      items: [
        {
          id: PLAYER as Ban['playerId'],
          displayName: 'Tester',
          riskScore: 0,
          firstSeenAt: NOW,
          lastSeenAt: NOW,
        },
      ],
      nextBefore: null,
    }),
  getPlayer: (id) =>
    Promise.resolve(
      id === PLAYER
        ? {
            id: PLAYER as Ban['playerId'],
            displayName: 'Tester',
            riskScore: 0,
            firstSeenAt: NOW,
            lastSeenAt: NOW,
            recentSessions: [],
            bans: [],
          }
        : null,
    ),
  listIdentityLinks: () =>
    Promise.resolve([
      {
        id: '1',
        playerId: OTHER_PLAYER as Ban['playerId'],
        score: 68,
        signals: [
          { signal: 'deviceToken', weight: 60 },
          { signal: 'ip', weight: 8 },
        ],
        otherBanned: true,
        createdAt: NOW,
      },
    ]),
  listActions: () => Promise.resolve({ items: [], nextBefore: null }),
  getAction: () => Promise.resolve(null),
  listBans: () => Promise.resolve({ items: [ban], nextBefore: null }),
  getBan: () => Promise.resolve(null),
  lookup: (query) =>
    Promise.resolve(
      query === BAN
        ? { type: 'SAC-BAN', id: BAN, record: ban, requiredScope: 'bans:read' as const }
        : null,
    ),
};

function createMemoryIdempotency(): IdempotencyStore {
  const entries = new Map<string, { fingerprint: string; status: number; body: unknown }>();
  return {
    begin(keyId, key, fingerprint): Promise<IdempotencyBegin> {
      const id = `${keyId}:${key}`;
      const existing = entries.get(id);
      if (!existing) {
        entries.set(id, { fingerprint, status: 0, body: null });
        return Promise.resolve({ kind: 'proceed' });
      }
      if (existing.fingerprint !== fingerprint) return Promise.resolve({ kind: 'reused' });
      if (existing.status === 0) return Promise.resolve({ kind: 'in_progress' });
      return Promise.resolve({
        kind: 'replay',
        response: { status: existing.status, body: existing.body },
      });
    },
    complete(keyId, key, response) {
      const entry = entries.get(`${keyId}:${key}`);
      if (entry) Object.assign(entry, response);
      return Promise.resolve();
    },
    abandon(keyId, key) {
      entries.delete(`${keyId}:${key}`);
      return Promise.resolve();
    },
    prune: () => Promise.resolve(),
  };
}

let server: Server;
let base = '';

beforeAll(async () => {
  const app = createHttpApp({
    getHealth: () =>
      Promise.resolve({
        status: 'ready',
        resource: 'simpleac',
        version: '0.1.0',
        migrationVersion: 4,
        uptimeSeconds: 1,
        dependencies: { oxLib: 'started', oxmysql: 'started' },
        failure: null,
      }),
    keys,
    directory,
    bans,
    detections: {} as DetectionService,
    cases: {} as CaseService,
    exceptions: {} as ExceptionService,
    profiles: {} as ProfileService,
    overview: {} as OverviewService,
    idempotency: createMemoryIdempotency(),
    requestLimiter: createRateLimiter(1000, 1000),
    failureLimiter: createRateLimiter(5, 0.0001),
  });
  const callback = app.callback();
  server = createServer((request, response) => {
    void callback(request, response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => {
  server.close();
});

function call(
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.token ? { authorization: `Bearer sac_${options.token}` } : {}),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
  });
}

const banBody = JSON.stringify({
  playerId: PLAYER,
  reason: 'cheating observed',
  durationHours: 24,
});

describe('authenticated HTTP API', () => {
  it('keeps the health route public', async () => {
    expect((await call('/v1/health')).status).toBe(200);
  });

  it('explains identity links to keys with identifiers:read only', async () => {
    const path = `/v1/players/${PLAYER}/links`;
    expect((await call(path, { token: 'reader' })).status).toBe(403);
    const response = await call(path, { token: 'investigator' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: {
        playerId: string;
        score: number;
        signals: { signal: string }[];
        otherBanned: boolean;
      }[];
    };
    expect(body.items[0]).toMatchObject({ playerId: OTHER_PLAYER, score: 68, otherBanned: true });
    expect(body.items[0]?.signals.map((entry) => entry.signal)).toEqual(['deviceToken', 'ip']);
    expect(
      (await call(`/v1/players/${OTHER_PLAYER}/links`, { token: 'investigator' })).status,
    ).toBe(404);
  });

  it('rejects missing and unknown keys with 401', async () => {
    expect((await call('/v1/players')).status).toBe(401);
    const response = await call('/v1/players', { token: 'nope' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('enforces scopes', async () => {
    expect((await call('/v1/players', { token: 'reader' })).status).toBe(200);
    expect((await call('/v1/bans', { token: 'reader' })).status).toBe(403);
    expect((await call('/v1/actions', { token: 'reader' })).status).toBe(403);
  });

  it('enforces per-key address restrictions', async () => {
    expect((await call('/v1/players', { token: 'locked' })).status).toBe(403);
  });

  it('validates query parameters', async () => {
    const response = await call('/v1/players?limit=1000', { token: 'admin' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  it('applies the scope of the looked-up record type', async () => {
    expect((await call(`/v1/lookup?q=${BAN}`, { token: 'admin' })).status).toBe(200);
    expect((await call(`/v1/lookup?q=${BAN}`, { token: 'reader' })).status).toBe(403);
    expect((await call('/v1/lookup?q=SAC-BAN-NOTREAL', { token: 'admin' })).status).toBe(404);
  });

  it('returns a request id and correlates it', async () => {
    const response = await call('/v1/players', {
      token: 'admin',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(response.headers.get('x-request-id')).toBe('abc-123');
    const replaced = await call('/v1/players', {
      token: 'admin',
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    expect(replaced.headers.get('x-request-id')).not.toBe('bad id with spaces');
  });
});

describe('mutations', () => {
  it('rejects invalid bodies and wrong content types', async () => {
    const invalid = await call('/v1/bans', {
      token: 'banner',
      method: 'POST',
      body: '{"playerId":"x"}',
    });
    expect(invalid.status).toBe(400);
    const malformed = await call('/v1/bans', { token: 'banner', method: 'POST', body: '{nope' });
    expect(malformed.status).toBe(400);
    const wrongType = await call('/v1/bans', {
      token: 'banner',
      method: 'POST',
      body: banBody,
      headers: { 'content-type': 'text/plain' },
    });
    expect(wrongType.status).toBe(415);
  });

  it('rejects oversized bodies', async () => {
    const response = await call('/v1/bans', {
      token: 'banner',
      method: 'POST',
      body: JSON.stringify({ reason: 'x'.repeat(70_000) }),
    });
    expect(response.status).toBe(413);
  });

  it('requires the write scope', async () => {
    const response = await call('/v1/bans', { token: 'reader', method: 'POST', body: banBody });
    expect(response.status).toBe(403);
  });

  it('replays a retried request instead of creating a second ban', async () => {
    const before = banCreations;
    const headers = { 'idempotency-key': 'retry-key-0001' };
    const first = await call('/v1/bans', {
      token: 'banner',
      method: 'POST',
      body: banBody,
      headers,
    });
    const second = await call('/v1/bans', {
      token: 'banner',
      method: 'POST',
      body: banBody,
      headers,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(banCreations).toBe(before + 1);
  });

  it('rejects reuse of a key with a different payload', async () => {
    const headers = { 'idempotency-key': 'retry-key-0002' };
    await call('/v1/bans', { token: 'banner', method: 'POST', body: banBody, headers });
    const different = JSON.stringify({
      playerId: PLAYER,
      reason: 'another reason',
      durationHours: 1,
    });
    const response = await call('/v1/bans', {
      token: 'banner',
      method: 'POST',
      body: different,
      headers,
    });
    expect(response.status).toBe(422);
  });
});

describe('failed-authentication throttling', () => {
  it('eventually answers 429 to a client guessing keys', async () => {
    let limited = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await call('/v1/players', { token: `guess${String(attempt)}` });
      if (response.status === 429) {
        limited = true;
        expect(response.headers.get('retry-after')).not.toBeNull();
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
