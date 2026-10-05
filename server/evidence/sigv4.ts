import { createHash, createHmac } from 'node:crypto';

/** AWS Signature Version 4, just enough for S3-compatible PUT/GET and presigned GET URLs. */

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

export const EMPTY_PAYLOAD_HASH = sha256('');
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/** RFC 3986 encoding as AWS requires it (encodeURIComponent leaves ! ' ( ) * alone). */
export function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function canonicalPath(path: string): string {
  return path
    .split('/')
    .map((segment) => awsEncode(segment))
    .join('/');
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

export interface SigningInput {
  method: string;
  host: string;
  /** Unencoded request path, for example `/bucket/some key.jpg`. */
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  payloadHash: string;
  region: string;
  service?: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  now: Date;
}

export interface SignedRequest {
  headers: Record<string, string>;
  signature: string;
}

export function signRequest(input: SigningInput): SignedRequest {
  const service = input.service ?? 's3';
  const stamp = amzDate(input.now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${input.region}/${service}/aws4_request`;

  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value.trim()]),
    ),
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': stamp,
    ...(input.sessionToken ? { 'x-amz-security-token': input.sessionToken } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.path),
    canonicalQuery(input.query ?? {}),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(input.secretKey, date, input.region, service))
    .update(stringToSign)
    .digest('hex');

  return {
    signature,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export interface PresignInput {
  method: string;
  protocol: 'http' | 'https';
  host: string;
  path: string;
  region: string;
  service?: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  expiresSeconds: number;
  now: Date;
}

export function presignUrl(input: PresignInput): { url: string; signature: string } {
  const service = input.service ?? 's3';
  const stamp = amzDate(input.now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${input.region}/${service}/aws4_request`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKey}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
    ...(input.sessionToken ? { 'X-Amz-Security-Token': input.sessionToken } : {}),
  };
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.path),
    canonicalQuery(query),
    `host:${input.host}\n`,
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(input.secretKey, date, input.region, service))
    .update(stringToSign)
    .digest('hex');

  return {
    signature,
    url: `${input.protocol}://${input.host}${canonicalPath(input.path)}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`,
  };
}

export { sha256 };
