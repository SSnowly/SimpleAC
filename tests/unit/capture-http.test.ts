import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpApp } from '../../server/http/app.js';
import { ApiError } from '../../server/http/errors.js';
import { createRateLimiter } from '../../server/http/middleware/rate-limit.js';
import type { ApiKeyService, VerifiedKey } from '../../server/services/api-keys.js';
import type { BanService } from '../../server/services/bans.js';
import type { CaptureService } from '../../server/services/captures.js';
import type { CaseService } from '../../server/services/cases.js';
import type { DetectionService } from '../../server/services/detections.js';
import type { Directory } from '../../server/services/directory.js';
import type { ExceptionService } from '../../server/services/exceptions.js';
import type { OverviewService } from '../../server/services/overview.js';
import type { ProfileService } from '../../server/services/profiles.js';
import type { ApiScope } from '../../shared/contracts/api.js';

const PLAYER = 'SAC-PLY-01JABCDEFGHJKMNPQRSTVWXYZ0';
const CAPTURE = 'SAC-CAP-01JABCDEFGHJKMNPQRSTVWXYZ0';
const NOW = '2026-10-04T12:00:00.000Z';
const VALID_TOKEN = 'a'.repeat(64);

const tokens: Record<string, ApiScope[]> = {
  reader: ['captures:read'],
  requester: ['captures:write'],
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

const capture = {
  id: CAPTURE,
  playerId: PLAYER,
  detectionId: null,
  caseId: null,
  status: 'uploaded',
  trigger: 'manual',
  requestedBy: 'SAC-KEY-REQUESTER',
  mediaType: 'image/jpeg',
  byteSize: 1234,
  sha256: 'f'.repeat(64),
  width: 1920,
  height: 1080,
  storageBackend: 'local',
  error: null,
  createdAt: NOW,
  uploadedAt: NOW,
};

const uploads: { token: string; size: number; contentType: string | undefined }[] = [];
const removed: { id: string; reason: string }[] = [];
let lastRequest: { playerId: string; reason: string } | undefined;

const captures: CaptureService = {
  receiveInline: () => Promise.resolve({ id: CAPTURE }),
  receiveUpload({ token, bytes, contentType }) {
    if (token === VALID_TOKEN.replace(/a/g, 'b')) {
      return Promise.reject(
        new ApiError(409, 'conflict', 'The upload token has expired or was already used.'),
      );
    }
    uploads.push({ token, size: bytes.length, contentType });
    return Promise.resolve({ id: CAPTURE });
  },
  list: () => Promise.resolve({ items: [capture], nextBefore: null } as never),
  get: (id) => Promise.resolve(id === CAPTURE ? ({ ...capture, ocr: [] } as never) : null),
  openImage: (id) => {
    if (id !== CAPTURE) return Promise.resolve(null);
    return Promise.resolve({
      kind: 'bytes',
      bytes: Buffer.from('jpegdata'),
      mediaType: 'image/jpeg',
    });
  },
  request(playerId, input) {
    lastRequest = { playerId, reason: input.reason };
    return Promise.resolve({ ids: [CAPTURE] });
  },
  ocrRules: () => ({
    version: 'test.1',
    minimumWordConfidence: 40,
    rules: [{ id: 'executors', kind: 'fuzzy', severity: 'high', termCount: 1, terms: ['eulen'] }],
  }),
  rescan: (id) => {
    if (id !== CAPTURE)
      return Promise.reject(new ApiError(404, 'not_found', 'The capture does not exist.'));
    return Promise.resolve({ captureId: id, status: 'queued' });
  },
  remove: (id, reason) => {
    removed.push({ id, reason });
    return Promise.resolve();
  },
  discardCleanSweep: () => Promise.resolve(false),
  prune: () => Promise.resolve(0),
};

let server: Server;
let base = '';

beforeAll(async () => {
  const app = createHttpApp({
    getHealth: () => Promise.reject(new Error('unused')),
    keys,
    directory: {} as Directory,
    bans: {} as BanService,
    detections: {} as DetectionService,
    cases: {} as CaseService,
    exceptions: {} as ExceptionService,
    profiles: {} as ProfileService,
    overview: {} as OverviewService,
    idempotency: {
      begin: () => Promise.resolve({ kind: 'proceed' }),
      complete: () => Promise.resolve(),
      abandon: () => Promise.resolve(),
      prune: () => Promise.resolve(),
    },
    captures: { service: captures, maxUploadBytes: 1024, uploadLimiter: createRateLimiter(50, 50) },
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

const upload = (token: string, body: Buffer | string, headers: Record<string, string> = {}) =>
  fetch(`${base}/v1/captures/upload/${token}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : new Uint8Array(body),
    headers: { 'content-type': 'image/jpeg', origin: 'https://cfx-nui-simpleac', ...headers },
  });

const authed = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer sac_${token}`, ...init.headers },
  });

describe('screenshot upload endpoint', () => {
  it('accepts an upload with only the token as credential and allows the NUI origin', async () => {
    const response = await upload(VALID_TOKEN, Buffer.alloc(300, 1));
    expect(response.status).toBe(201);
    expect(((await response.json()) as { id: string }).id).toBe(CAPTURE);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://cfx-nui-simpleac');
    expect(uploads.at(-1)).toMatchObject({
      token: VALID_TOKEN,
      size: 300,
      contentType: 'image/jpeg',
    });
  });

  it('does not grant CORS to other origins', async () => {
    const response = await upload(VALID_TOKEN, Buffer.alloc(10, 1), {
      origin: 'https://evil.example',
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers the CORS preflight', async () => {
    const response = await fetch(`${base}/v1/captures/upload/${VALID_TOKEN}`, {
      method: 'OPTIONS',
      headers: { origin: 'https://cfx-nui-simpleac', 'access-control-request-method': 'POST' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('rejects malformed tokens, empty bodies and non-POST methods', async () => {
    expect((await upload('short', Buffer.alloc(10, 1))).status).toBe(404);
    expect((await upload(VALID_TOKEN, '')).status).toBe(400);
    const get = await fetch(`${base}/v1/captures/upload/${VALID_TOKEN}`);
    expect(get.status).toBe(403);
  });

  it('enforces the upload size limit, including from the declared length', async () => {
    const response = await upload(VALID_TOKEN, Buffer.alloc(2048, 1));
    expect(response.status).toBe(413);
  });

  it('surfaces token reuse from the service', async () => {
    const response = await upload('b'.repeat(64), Buffer.alloc(10, 1));
    expect(response.status).toBe(409);
  });
});

describe('capture API', () => {
  it('requires captures:read for listing, detail and image', async () => {
    expect((await authed('/v1/captures', 'nobody')).status).toBe(403);
    const list = await authed('/v1/captures', 'reader');
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: { id: string }[] }).items[0]?.id).toBe(CAPTURE);
    expect((await authed(`/v1/captures/${CAPTURE}`, 'reader')).status).toBe(200);
    expect((await authed('/v1/captures/SAC-CAP-01JABCDEFGHJKMNPQRSTVWXYZ9', 'reader')).status).toBe(
      404,
    );
  });

  it('streams a stored image with its media type', async () => {
    const response = await authed(`/v1/captures/${CAPTURE}/image`, 'reader');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/jpeg');
    expect(await response.text()).toBe('jpegdata');
  });

  it('requests a capture for a player with captures:write', async () => {
    const body = JSON.stringify({ reason: 'suspected aim assistance' });
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'capture-request-1' };
    expect(
      (await authed(`/v1/players/${PLAYER}/captures`, 'reader', { method: 'POST', body, headers }))
        .status,
    ).toBe(403);
    const response = await authed(`/v1/players/${PLAYER}/captures`, 'requester', {
      method: 'POST',
      body,
      headers,
    });
    expect(response.status).toBe(202);
    expect(((await response.json()) as { ids: string[] }).ids).toEqual([CAPTURE]);
    expect(lastRequest).toEqual({ playerId: PLAYER, reason: 'suspected aim assistance' });
  });

  it('shows the OCR rules to captures:read', async () => {
    expect((await authed('/v1/ocr/rules', 'nobody')).status).toBe(403);
    const response = await authed('/v1/ocr/rules', 'reader');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { version: string; rules: { id: string }[] };
    expect(body.version).toBe('test.1');
    expect(body.rules[0]?.id).toBe('executors');
  });

  it('re-runs OCR for captures:write only', async () => {
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'rescan-1' };
    const path = `/v1/captures/${CAPTURE}/rescan`;
    expect((await authed(path, 'reader', { method: 'POST', body: '{}', headers })).status).toBe(
      403,
    );
    const response = await authed(path, 'requester', { method: 'POST', body: '{}', headers });
    expect(response.status).toBe(202);
    expect(((await response.json()) as { status: string }).status).toBe('queued');
  });

  it('deletes a stored image with a reason and rejects a missing one', async () => {
    const path = `/v1/captures/${CAPTURE}/delete`;
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'delete-1' };
    const missing = await authed(path, 'requester', { method: 'POST', body: '{}', headers });
    expect(missing.status).toBe(400);
    const response = await authed(path, 'requester', {
      method: 'POST',
      body: JSON.stringify({ reason: 'contains a private chat' }),
      headers: { ...headers, 'idempotency-key': 'delete-2' },
    });
    expect(response.status).toBe(204);
    expect(removed.at(-1)).toEqual({ id: CAPTURE, reason: 'contains a private chat' });
  });
});
