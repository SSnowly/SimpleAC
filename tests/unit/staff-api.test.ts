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
import type { OverviewService } from '../../server/services/overview.js';
import type { ProfileService } from '../../server/services/profiles.js';
import type { ApiScope } from '../../shared/contracts/api.js';

const PLAYER = 'SAC-PLY-01JABCDEFGHJKMNPQRSTVWXYZ0';
const DETECTION = 'SAC-DET-01JABCDEFGHJKMNPQRSTVWXYZ1';
const CASE = 'SAC-CASE-01JABCDEFGHJKMNPQRSTVWXYZ2';
const EXCEPTION = 'SAC-EXC-01JABCDEFGHJKMNPQRSTVWXYZ3';
const PROFILE = 'SAC-PRF-01JABCDEFGHJKMNPQRSTVWXYZ4';
const CAPTURE = 'SAC-CAP-01JABCDEFGHJKMNPQRSTVWXYZ5';
const NOW = '2026-10-05T10:00:00.000Z';

const tokens: Record<string, ApiScope[]> = {
  reader: ['detections:read', 'cases:read', 'exceptions:read', 'profiles:read'],
  reviewer: ['detections:write', 'cases:write', 'exceptions:write'],
  nobody: ['players:read'],
};

const keys: ApiKeyService = {
  create: () => Promise.reject(new Error('unused')),
  revoke: () => Promise.resolve(false),
  list: () => Promise.resolve([]),
  authenticate(token) {
    const scopes = tokens[token.replace('sac_', '')];
    if (!scopes) return Promise.resolve(null);
    const key: VerifiedKey = {
      id: `SAC-KEY-${token.toUpperCase()}`,
      name: token,
      scopes,
      allowedIps: [],
    };
    return Promise.resolve(key);
  },
};

const detection = {
  id: DETECTION,
  playerId: PLAYER,
  sessionId: null,
  caseId: CASE,
  ruleKey: 'evidence.ocr_match',
  ruleVersion: 1,
  category: 'integrity',
  severity: 40,
  confidence: 0.9,
  score: 36,
  outcome: 'log',
  status: 'open',
  occurredAt: NOW,
  createdAt: NOW,
};

const capture = {
  id: CAPTURE,
  playerId: PLAYER,
  detectionId: DETECTION,
  caseId: CASE,
  status: 'uploaded',
  trigger: 'sweep',
  requestedBy: 'system',
  mediaType: 'image/jpeg',
  byteSize: 10,
  sha256: 'a'.repeat(64),
  width: 1920,
  height: 1080,
  storageBackend: 'local',
  error: null,
  createdAt: NOW,
  uploadedAt: NOW,
};

const caseRecord = {
  id: CASE,
  playerId: PLAYER,
  status: 'open',
  priority: 20,
  title: 'evidence.ocr_match',
  assignedTo: null,
  detectionCount: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const caseDetail = { ...caseRecord, detections: [detection], events: [], captures: [capture] };

const exception = {
  id: EXCEPTION,
  scopeType: 'resource',
  scopeValue: 'my_admin_menu',
  effect: 'allow',
  reason: 'staff tooling',
  createdBy: 'SAC-KEY-REVIEWER',
  expiresAt: null,
  revokedByActionId: null,
  active: true,
  createdAt: NOW,
};

const calls: { name: string; args: unknown[] }[] = [];
const record =
  (name: string, result: unknown) =>
  (...args: unknown[]): Promise<unknown> => {
    calls.push({ name, args });
    return Promise.resolve(result);
  };

const detections = {
  list: record('detections.list', { items: [detection], nextBefore: null }),
  get: (id: string) =>
    Promise.resolve(
      id === DETECTION ? { ...detection, measured: {}, evidence: [], captures: [capture] } : null,
    ),
  review: record('detections.review', {
    ...detection,
    status: 'dismissed',
    measured: {},
    evidence: [],
    captures: [],
  }),
} as unknown as DetectionService;

const cases = {
  list: record('cases.list', { items: [caseRecord], nextBefore: null }),
  get: (id: string) => Promise.resolve(id === CASE ? caseDetail : null),
  create: record('cases.create', caseDetail),
  update: record('cases.update', caseDetail),
  addNote: record('cases.addNote', caseDetail),
  linkDetection: record('cases.linkDetection', caseDetail),
  linkCapture: record('cases.linkCapture', caseDetail),
} as unknown as CaseService;

const exceptions = {
  list: record('exceptions.list', { items: [exception], nextBefore: null }),
  get: (id: string) => Promise.resolve(id === EXCEPTION ? exception : null),
  create: record('exceptions.create', exception),
  revoke: record('exceptions.revoke', {
    ...exception,
    active: false,
  }),
} as unknown as ExceptionService;

const profiles = {
  list: () =>
    Promise.resolve([
      {
        id: PROFILE,
        name: 'balanced',
        description: null,
        activeVersionId: PROFILE,
        activeVersion: 1,
        versionCount: 1,
        createdAt: NOW,
      },
    ] as never),
  get: (id: string) =>
    Promise.resolve(
      id === PROFILE
        ? {
            id: PROFILE,
            name: 'balanced',
            description: null,
            activeVersionId: PROFILE,
            activeVersion: 1,
            versionCount: 1,
            createdAt: NOW,
            versions: [{ id: PROFILE, version: 1, createdBy: 'system', createdAt: NOW }],
            config: { caseThreshold: 40 },
          }
        : (null as never),
    ) as never,
} as unknown as ProfileService;

const overview = {
  get: () =>
    Promise.resolve({
      generatedAt: NOW,
      players: { total: 3, seenLast24h: 1 },
      detections: { last24h: 4, open: 2, topRules: [{ ruleKey: 'evidence.ocr_match', count: 4 }] },
      cases: { open: 1, investigating: 0 },
      bans: { active: 0 },
      captures: { total: 9, last24h: 5, ocrMatchesLast24h: 1 },
    }),
} as unknown as OverviewService;

let server: Server;
let base = '';

beforeAll(async () => {
  const app = createHttpApp({
    getHealth: () => Promise.reject(new Error('unused')),
    keys,
    directory: {} as Directory,
    bans: {} as BanService,
    detections,
    cases,
    exceptions,
    profiles,
    overview,
    idempotency: {
      begin: () => Promise.resolve({ kind: 'proceed' }),
      complete: () => Promise.resolve(),
      abandon: () => Promise.resolve(),
      prune: () => Promise.resolve(),
    },
    requestLimiter: createRateLimiter(1000, 1000),
  });
  const callback = app.callback();
  server = createServer((request, response) => {
    void callback(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => {
  server.close();
});

let keyCounter = 0;
const call = (path: string, token: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      authorization: `Bearer sac_${token}`,
      ...(body === undefined
        ? {}
        : {
            'content-type': 'application/json',
            'idempotency-key': `staff-test-${String(++keyCounter)}`,
          }),
    },
  });

describe('overview', () => {
  it('needs detections:read', async () => {
    expect((await call('/v1/overview', 'nobody')).status).toBe(403);
    const response = await call('/v1/overview', 'reader');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { captures: { total: number } }).captures.total).toBe(9);
  });
});

describe('detections', () => {
  it('lists, filters and reads one', async () => {
    expect((await call('/v1/detections', 'nobody')).status).toBe(403);
    const list = await call(
      `/v1/detections?playerId=${PLAYER}&status=open&ruleKey=evidence.ocr_match`,
      'reader',
    );
    expect(list.status).toBe(200);
    expect(calls.at(-1)?.name).toBe('detections.list');
    expect(calls.at(-1)?.args[0]).toMatchObject({
      playerId: PLAYER,
      status: 'open',
      ruleKey: 'evidence.ocr_match',
      limit: 25,
    });
    expect((await call(`/v1/detections/${DETECTION}`, 'reader')).status).toBe(200);
    expect((await call('/v1/detections/SAC-DET-01JABCDEFGHJKMNPQRSTVWXYZZ', 'reader')).status).toBe(
      404,
    );
  });

  it('rejects an invalid filter', async () => {
    expect((await call('/v1/detections?status=bogus', 'reader')).status).toBe(400);
    expect((await call('/v1/detections?ruleKey=Bad Key', 'reader')).status).toBe(400);
  });

  it('reviews with detections:write and a reason', async () => {
    const path = `/v1/detections/${DETECTION}/review`;
    expect(
      (await call(path, 'reader', { status: 'dismissed', reason: 'false positive' })).status,
    ).toBe(403);
    expect((await call(path, 'reviewer', { status: 'dismissed' })).status).toBe(400);
    expect((await call(path, 'reviewer', { status: 'maybe', reason: 'unsure why' })).status).toBe(
      400,
    );
    const response = await call(path, 'reviewer', {
      status: 'dismissed',
      reason: 'false positive',
    });
    expect(response.status).toBe(200);
    expect(calls.at(-1)?.name).toBe('detections.review');
  });
});

describe('cases', () => {
  it('lists and reads', async () => {
    expect((await call('/v1/cases?status=open', 'reader')).status).toBe(200);
    expect(calls.at(-1)?.name).toBe('cases.list');
    expect(calls.at(-1)?.args[0]).toMatchObject({ status: 'open' });
    expect((await call(`/v1/cases/${CASE}`, 'reader')).status).toBe(200);
    expect((await call('/v1/cases/SAC-CASE-01JABCDEFGHJKMNPQRSTVWXYZZ', 'reader')).status).toBe(
      404,
    );
    expect((await call('/v1/cases?status=weird', 'reader')).status).toBe(400);
  });

  it('creates, updates, notes and links with cases:write', async () => {
    expect(
      (
        await call('/v1/cases', 'reader', {
          playerId: PLAYER,
          title: 'x'.repeat(5),
          reason: 'manual',
        })
      ).status,
    ).toBe(403);

    const created = await call('/v1/cases', 'reviewer', {
      playerId: PLAYER,
      title: 'Suspicious aim',
      reason: 'reported',
    });
    expect(created.status).toBe(201);
    expect(
      (await call('/v1/cases', 'reviewer', { playerId: 'nope', title: 'abc', reason: 'abc' }))
        .status,
    ).toBe(400);

    expect(
      (await call(`/v1/cases/${CASE}/update`, 'reviewer', { reason: 'nothing to change' })).status,
    ).toBe(400);
    const updated = await call(`/v1/cases/${CASE}/update`, 'reviewer', {
      status: 'investigating',
      assignedTo: 'staff-1',
      reason: 'taking it',
    });
    expect(updated.status).toBe(200);

    const note = await call(`/v1/cases/${CASE}/notes`, 'reviewer', { note: 'watched a replay' });
    expect(note.status).toBe(201);
    expect((await call(`/v1/cases/${CASE}/notes`, 'reviewer', { note: '' })).status).toBe(400);

    expect(
      (await call(`/v1/cases/${CASE}/detections`, 'reviewer', { detectionId: DETECTION })).status,
    ).toBe(200);
    expect(calls.at(-1)?.name).toBe('cases.linkDetection');
    expect(calls.at(-1)?.args.slice(0, 2)).toEqual([CASE, DETECTION]);
    expect(
      (await call(`/v1/cases/${CASE}/captures`, 'reviewer', { captureId: CAPTURE })).status,
    ).toBe(200);
    expect(calls.at(-1)?.name).toBe('cases.linkCapture');
    expect(calls.at(-1)?.args.slice(0, 2)).toEqual([CASE, CAPTURE]);
    expect(
      (await call(`/v1/cases/${CASE}/captures`, 'reviewer', { captureId: DETECTION })).status,
    ).toBe(200);
  });
});

describe('exceptions', () => {
  it('lists and reads', async () => {
    expect((await call('/v1/exceptions?active=true&scopeType=resource', 'reader')).status).toBe(
      200,
    );
    expect(calls.at(-1)?.name).toBe('exceptions.list');
    expect(calls.at(-1)?.args[0]).toMatchObject({ activeOnly: true, scopeType: 'resource' });
    expect((await call(`/v1/exceptions/${EXCEPTION}`, 'reader')).status).toBe(200);
    expect((await call('/v1/exceptions/SAC-EXC-01JABCDEFGHJKMNPQRSTVWXYZZ', 'reader')).status).toBe(
      404,
    );
  });

  it('creates and revokes with exceptions:write', async () => {
    const body = {
      scopeType: 'resource',
      scopeValue: 'my_admin_menu',
      reason: 'staff tooling',
      durationHours: 24,
    };
    expect((await call('/v1/exceptions', 'reader', body)).status).toBe(403);
    const created = await call('/v1/exceptions', 'reviewer', body);
    expect(created.status).toBe(201);
    expect(calls.at(-1)?.name).toBe('exceptions.create');
    expect(calls.at(-1)?.args[0]).toMatchObject({
      scopeType: 'resource',
      scopeValue: 'my_admin_menu',
      effect: 'allow',
      durationHours: 24,
    });
    expect(
      (await call('/v1/exceptions', 'reviewer', { ...body, scopeType: 'everything' })).status,
    ).toBe(400);
    expect((await call('/v1/exceptions', 'reviewer', { ...body, effect: 'ban' })).status).toBe(400);

    const revoked = await call(`/v1/exceptions/${EXCEPTION}/revoke`, 'reviewer', {
      reason: 'no longer needed',
    });
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { active: boolean }).active).toBe(false);
  });
});

describe('profiles', () => {
  it('needs profiles:read and returns the active config', async () => {
    expect((await call('/v1/profiles', 'nobody')).status).toBe(403);
    const list = await call('/v1/profiles', 'reader');
    expect(((await list.json()) as { items: { name: string }[] }).items[0]?.name).toBe('balanced');
    const detail = await call(`/v1/profiles/${PROFILE}`, 'reader');
    expect(
      ((await detail.json()) as { config: { caseThreshold: number } }).config.caseThreshold,
    ).toBe(40);
    expect((await call('/v1/profiles/SAC-PRF-01JABCDEFGHJKMNPQRSTVWXYZZ', 'reader')).status).toBe(
      404,
    );
  });
});
