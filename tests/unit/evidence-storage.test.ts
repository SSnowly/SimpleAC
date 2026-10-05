import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEvidenceConfig } from '../../server/evidence/config.js';
import type { HttpRequest } from '../../server/evidence/http.js';
import { type ImageInfo, sniffImage } from '../../server/evidence/images.js';
import { EMPTY_PAYLOAD_HASH, presignUrl, signRequest } from '../../server/evidence/sigv4.js';
import {
  createFivemanageStorage,
  createLocalStorage,
  createS3Storage,
} from '../../server/evidence/storage.js';

const AWS_ACCESS = 'AKIAIOSFODNN7EXAMPLE';
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const AWS_NOW = new Date('2013-05-24T00:00:00Z');

function jpeg(width: number, height: number): Buffer {
  const frame = Buffer.alloc(19);
  frame.writeUInt16BE(17, 0);
  frame[2] = 8;
  frame.writeUInt16BE(height, 3);
  frame.writeUInt16BE(width, 5);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]),
    Buffer.from([0xff, 0xc0]),
    frame,
    Buffer.alloc(16),
  ]);
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function webpExtended(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(40);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(32, 4);
  buffer.write('WEBP', 8, 'latin1');
  buffer.write('VP8X', 12, 'latin1');
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

const image: ImageInfo = { mediaType: 'image/jpeg', extension: 'jpg', width: 1920, height: 1080 };
const bytes = Buffer.from('evidence-bytes');

describe('SigV4', () => {
  it('matches the AWS documentation GET Object example', () => {
    const signed = signRequest({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_PAYLOAD_HASH,
      region: 'us-east-1',
      accessKey: AWS_ACCESS,
      secretKey: AWS_SECRET,
      now: AWS_NOW,
    });
    expect(signed.signature).toBe(
      'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('matches the AWS documentation presigned URL example', () => {
    const { url, signature } = presignUrl({
      method: 'GET',
      protocol: 'https',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      accessKey: AWS_ACCESS,
      secretKey: AWS_SECRET,
      expiresSeconds: 86400,
      now: AWS_NOW,
    });
    expect(signature).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
    expect(url).toContain('X-Amz-Expires=86400');
    expect(url.endsWith(`X-Amz-Signature=${signature}`)).toBe(true);
  });
});

describe('image sniffing', () => {
  it('reads type and dimensions from the bytes', () => {
    expect(sniffImage(jpeg(1920, 1080))).toMatchObject({
      mediaType: 'image/jpeg',
      width: 1920,
      height: 1080,
    });
    expect(sniffImage(png(800, 600))).toMatchObject({ mediaType: 'image/png', width: 800 });
    expect(sniffImage(webpExtended(1280, 720))).toMatchObject({
      mediaType: 'image/webp',
      width: 1280,
      height: 720,
    });
  });

  it('rejects anything else, including oversized dimensions', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(64))).toBeNull();
    expect(sniffImage(png(70000, 10))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a......................'))).toBeNull();
  });
});

describe('local storage', () => {
  let directory = '';
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('stores, reads back and removes evidence, and refuses path traversal', async () => {
    directory = await mkdtemp(join(tmpdir(), 'simpleac-evidence-'));
    const storage = createLocalStorage(directory);
    const stored = await storage.put({
      captureId: 'SAC-CAP-01TEST',
      playerId: 'SAC-PLY-X',
      bytes,
      image,
      createdAt: new Date('2026-10-04T12:00:00Z'),
    });
    expect(stored.key).toBe('2026/10/SAC-CAP-01TEST.jpg');
    const opened = await storage.open({ ...stored, mediaType: 'image/jpeg' });
    expect(opened).toMatchObject({ kind: 'bytes', mediaType: 'image/jpeg' });
    expect(opened.kind === 'bytes' && opened.bytes.equals(bytes)).toBe(true);

    await expect(
      storage.open({ key: '../../etc/passwd', url: null, mediaType: 'image/jpeg' }),
    ).rejects.toThrow('invalid evidence key');
    await storage.remove(stored.key);
    expect(await readdir(join(directory, '2026', '10'))).toEqual([]);
  });
});

describe('Fivemanage storage', () => {
  it('uploads multipart with the API key and keeps the returned URL', async () => {
    let seen: HttpRequest | undefined;
    const storage = createFivemanageStorage('secret-key', (request) => {
      seen = request;
      return Promise.resolve({
        status: 200,
        body: Buffer.from(
          JSON.stringify({
            data: { id: 'abc123', url: 'https://r2.fivemanage.com/x/abc123.jpg' },
            status: 'ok',
          }),
        ),
      });
    });
    const stored = await storage.put({
      captureId: 'SAC-CAP-01TEST',
      playerId: 'SAC-PLY-X',
      bytes,
      image,
      createdAt: new Date(),
    });
    expect(stored).toEqual({ key: 'abc123', url: 'https://r2.fivemanage.com/x/abc123.jpg' });
    expect(seen?.url).toBe('https://api.fivemanage.com/api/v3/file');
    expect(seen?.headers?.['authorization']).toBe('secret-key');
    expect(seen?.headers?.['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    const body = seen?.body?.toString('latin1') ?? '';
    expect(body).toContain('name="file"; filename="SAC-CAP-01TEST.jpg"');
    expect(body).toContain('evidence-bytes');
    expect(await storage.open({ ...stored, mediaType: 'image/jpeg' })).toEqual({
      kind: 'redirect',
      url: stored.url,
    });
  });

  it('fails on a rejected upload', async () => {
    const storage = createFivemanageStorage('k', () =>
      Promise.resolve({ status: 401, body: Buffer.from('nope') }),
    );
    await expect(
      storage.put({ captureId: 'SAC-CAP-1', playerId: 'p', bytes, image, createdAt: new Date() }),
    ).rejects.toThrow('HTTP 401');
  });
});

describe('S3 storage', () => {
  const base = {
    endpoint: null,
    region: 'eu-central-1',
    bucket: 'evidence',
    accessKey: AWS_ACCESS,
    secretKey: AWS_SECRET,
    sessionToken: null,
    prefix: 'simpleac/',
    pathStyle: false,
    publicBaseUrl: null,
    presignSeconds: 300,
  } as const;

  it('signs a virtual-hosted PUT for AWS', async () => {
    let seen: HttpRequest | undefined;
    const storage = createS3Storage(
      { backend: 's3', ...base },
      (request) => {
        seen = request;
        return Promise.resolve({ status: 200, body: Buffer.alloc(0) });
      },
      () => new Date('2026-10-04T12:00:00Z'),
    );
    const stored = await storage.put({
      captureId: 'SAC-CAP-01TEST',
      playerId: 'p',
      bytes,
      image,
      createdAt: new Date('2026-10-04T12:00:00Z'),
    });
    expect(stored.key).toBe('2026/10/SAC-CAP-01TEST.jpg');
    expect(seen?.method).toBe('PUT');
    expect(seen?.url).toBe(
      'https://evidence.s3.eu-central-1.amazonaws.com/simpleac/2026/10/SAC-CAP-01TEST.jpg',
    );
    expect(seen?.headers?.['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20261004\/eu-central-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('uses path style for custom endpoints and presigns reads', async () => {
    let seen: HttpRequest | undefined;
    const storage = createS3Storage(
      {
        backend: 's3',
        ...base,
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        pathStyle: true,
        region: 'auto',
      },
      (request) => {
        seen = request;
        return Promise.resolve({ status: 200, body: Buffer.alloc(0) });
      },
      () => new Date('2026-10-04T12:00:00Z'),
    );
    await storage.put({
      captureId: 'SAC-CAP-01TEST',
      playerId: 'p',
      bytes,
      image,
      createdAt: new Date('2026-10-04T12:00:00Z'),
    });
    expect(seen?.url).toBe(
      'https://acct.r2.cloudflarestorage.com/evidence/simpleac/2026/10/SAC-CAP-01TEST.jpg',
    );
    const opened = await storage.open({
      key: '2026/10/SAC-CAP-01TEST.jpg',
      url: null,
      mediaType: 'image/jpeg',
    });
    expect(opened.kind).toBe('redirect');
    expect(opened.kind === 'redirect' && opened.url).toMatch(/X-Amz-Expires=300.*X-Amz-Signature=/);
  });

  it('serves from a public base URL when configured', async () => {
    const storage = createS3Storage({
      backend: 's3',
      ...base,
      publicBaseUrl: 'https://cdn.example.com',
    });
    expect(
      await storage.open({ key: '2026/10/SAC-CAP-1.jpg', url: null, mediaType: 'image/jpeg' }),
    ).toEqual({ kind: 'redirect', url: 'https://cdn.example.com/simpleac/2026/10/SAC-CAP-1.jpg' });
  });
});

describe('evidence config', () => {
  const read =
    (values: Record<string, string>) =>
    (name: string, fallback: string): string =>
      values[name] ?? fallback;

  it('defaults to local storage inside the resource', () => {
    const config = loadEvidenceConfig(read({}), '/srv/resources/SimpleAC');
    expect(config.storage).toMatchObject({ backend: 'local' });
    expect(config.storage.backend === 'local' && config.storage.directory).toContain('evidence');
    expect(config.retentionDays).toBe(30);
  });

  it('requires credentials for remote backends and rejects unknown ones', () => {
    expect(() =>
      loadEvidenceConfig(read({ 'simpleac:capture_storage': 'fivemanage' }), '/r'),
    ).toThrow('simpleac:fivemanage_key');
    expect(() => loadEvidenceConfig(read({ 'simpleac:capture_storage': 's3' }), '/r')).toThrow(
      'simpleac:s3_bucket',
    );
    expect(() => loadEvidenceConfig(read({ 'simpleac:capture_storage': 'ftp' }), '/r')).toThrow(
      'local, fivemanage or s3',
    );
  });

  it('builds an S3 config with a normalised prefix and path style for custom endpoints', () => {
    const config = loadEvidenceConfig(
      read({
        'simpleac:capture_storage': 's3',
        'simpleac:s3_bucket': 'b',
        'simpleac:s3_access_key': 'a',
        'simpleac:s3_secret_key': 's',
        'simpleac:s3_endpoint': 'https://minio.local:9000/',
        'simpleac:s3_prefix': '/evidence',
      }),
      '/r',
    );
    expect(config.storage).toMatchObject({
      backend: 's3',
      endpoint: 'https://minio.local:9000',
      prefix: 'evidence/',
      pathStyle: true,
    });
  });
});
