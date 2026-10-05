import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StorageBackend, StorageConfig } from './config.js';
import { defaultHttpClient, type HttpClient } from './http.js';
import type { ImageInfo } from './images.js';
import { canonicalPath, EMPTY_PAYLOAD_HASH, presignUrl, sha256, signRequest } from './sigv4.js';

export interface PutInput {
  captureId: string;
  playerId: string;
  bytes: Buffer;
  image: ImageInfo;
  createdAt: Date;
}

export interface StoredObject {
  /** Backend-specific key: a relative path (local), an object key (s3) or a file id (fivemanage). */
  key: string;
  /** Public URL when the backend provides one. */
  url: string | null;
}

export type OpenedObject =
  | { kind: 'bytes'; bytes: Buffer; mediaType: string }
  | { kind: 'redirect'; url: string };

export interface EvidenceStorage {
  readonly backend: StorageBackend;
  put(input: PutInput): Promise<StoredObject>;
  open(object: StoredObject & { mediaType: string }): Promise<OpenedObject>;
  /** Best effort: external services that offer no delete API leave the object to their own retention. */
  remove(key: string): Promise<void>;
}

const LOCAL_KEY = /^\d{4}\/\d{2}\/SAC-CAP-[0-9A-Z]{1,32}\.(jpg|png|webp)$/;

export function createLocalStorage(directory: string): EvidenceStorage {
  const resolve = (key: string): string => {
    if (!LOCAL_KEY.test(key)) throw new Error('invalid evidence key');
    return join(directory, key);
  };

  return {
    backend: 'local',
    async put(input) {
      const year = String(input.createdAt.getUTCFullYear());
      const month = String(input.createdAt.getUTCMonth() + 1).padStart(2, '0');
      const key = `${year}/${month}/${input.captureId}.${input.image.extension}`;
      const target = resolve(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, input.bytes, { flag: 'wx', mode: 0o640 });
      return { key, url: null };
    },
    async open(object) {
      return {
        kind: 'bytes',
        bytes: await readFile(resolve(object.key)),
        mediaType: object.mediaType,
      };
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

function multipart(
  fields: Record<string, string>,
  file: { name: string; filename: string; mediaType: string; bytes: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----simpleac${randomBytes(12).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.mediaType}\r\n\r\n`,
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const FIVEMANAGE_UPLOAD = 'https://api.fivemanage.com/api/v3/file';

export function createFivemanageStorage(
  apiKey: string,
  http: HttpClient = defaultHttpClient,
): EvidenceStorage {
  return {
    backend: 'fivemanage',
    async put(input) {
      const filename = `${input.captureId}.${input.image.extension}`;
      const { body, contentType } = multipart(
        {
          filename,
          path: 'simpleac',
          metadata: JSON.stringify({ captureId: input.captureId, playerId: input.playerId }),
        },
        { name: 'file', filename, mediaType: input.image.mediaType, bytes: input.bytes },
      );
      const response = await http({
        url: FIVEMANAGE_UPLOAD,
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': contentType },
        body,
        timeoutMs: 30_000,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Fivemanage rejected the upload (HTTP ${String(response.status)})`);
      }
      const parsed: unknown = JSON.parse(response.body.toString('utf8'));
      const data =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as { data?: { id?: unknown; url?: unknown } }).data
          : undefined;
      if (typeof data?.id !== 'string' || typeof data.url !== 'string') {
        throw new Error('Fivemanage returned an unexpected response');
      }
      return { key: data.id, url: data.url };
    },
    open(object) {
      if (!object.url) return Promise.reject(new Error('the stored object has no URL'));
      return Promise.resolve({ kind: 'redirect', url: object.url });
    },
    remove: () => Promise.resolve(),
  };
}

type S3Config = Extract<StorageConfig, { backend: 's3' }>;

export function createS3Storage(
  config: S3Config,
  http: HttpClient = defaultHttpClient,
  clock: () => Date = () => new Date(),
): EvidenceStorage {
  const endpoint = config.endpoint ? new URL(config.endpoint) : null;
  const protocol: 'http' | 'https' = endpoint?.protocol === 'http:' ? 'http' : 'https';

  const target = (key: string): { host: string; path: string } => {
    const objectKey = `${config.prefix}${key}`;
    if (config.pathStyle) {
      return {
        host: endpoint ? endpoint.host : `s3.${config.region}.amazonaws.com`,
        path: `/${config.bucket}/${objectKey}`,
      };
    }
    return {
      host: endpoint
        ? `${config.bucket}.${endpoint.host}`
        : `${config.bucket}.s3.${config.region}.amazonaws.com`,
      path: `/${objectKey}`,
    };
  };

  const credentials = {
    region: config.region,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
  };

  const send = async (
    method: string,
    key: string,
    body: Buffer | undefined,
    headers: Record<string, string>,
  ) => {
    const { host, path } = target(key);
    const signed = signRequest({
      method,
      host,
      path,
      headers,
      payloadHash: body ? sha256(body) : EMPTY_PAYLOAD_HASH,
      now: clock(),
      ...credentials,
    });
    const { host: _host, ...sendHeaders } = signed.headers;
    return http({
      url: `${protocol}://${host}${canonicalPath(path)}`,
      method,
      headers: sendHeaders,
      ...(body ? { body } : {}),
      timeoutMs: 30_000,
    });
  };

  return {
    backend: 's3',
    async put(input) {
      const key = `${input.createdAt.getUTCFullYear()}/${String(input.createdAt.getUTCMonth() + 1).padStart(2, '0')}/${input.captureId}.${input.image.extension}`;
      const response = await send('PUT', key, input.bytes, {
        'content-type': input.image.mediaType,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`S3 rejected the upload (HTTP ${String(response.status)})`);
      }
      return { key, url: null };
    },
    open(object) {
      const { host, path } = target(object.key);
      if (config.publicBaseUrl) {
        return Promise.resolve({
          kind: 'redirect',
          url: `${config.publicBaseUrl}/${config.prefix}${object.key}`,
        });
      }
      const { url } = presignUrl({
        method: 'GET',
        protocol,
        host,
        path,
        expiresSeconds: config.presignSeconds,
        now: clock(),
        ...credentials,
      });
      return Promise.resolve({ kind: 'redirect', url });
    },
    async remove(key) {
      await send('DELETE', key, undefined, {});
    },
  };
}

export function createStorage(config: StorageConfig): EvidenceStorage {
  if (config.backend === 'local') return createLocalStorage(config.directory);
  if (config.backend === 'fivemanage') return createFivemanageStorage(config.apiKey);
  return createS3Storage(config);
}
