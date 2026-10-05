import type { IncomingMessage } from 'node:http';
import type { Middleware } from 'koa';
import { ApiError } from '../errors.js';
import type { HttpState } from '../types.js';

export const MAX_BODY_BYTES = 64 * 1024;

/** Reads a request body into memory, failing with 413 as soon as it exceeds the limit. */
export function readBuffer(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      received += buffer.length;
      if (received > limit) {
        fail(new ApiError(413, 'payload_too_large', 'The request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on('error', () => {
      fail(new ApiError(400, 'bad_request', 'The request body could not be read.'));
    });
  });
}

async function readLimited(request: IncomingMessage, limit: number): Promise<string> {
  return (await readBuffer(request, limit)).toString('utf8');
}

export const UPLOAD_PATH_PREFIX = '/v1/captures/upload/';

/**
 * Rejects oversized bodies from the header alone, before any authentication work. Screenshot uploads get
 * their own, larger limit.
 */
export function bodyLimitMiddleware(uploadLimit: number): Middleware<HttpState> {
  return async (context, next) => {
    const limit = context.path.startsWith(UPLOAD_PATH_PREFIX) ? uploadLimit : MAX_BODY_BYTES;
    if (context.request.length > limit) {
      throw new ApiError(413, 'payload_too_large', 'The request body is too large.');
    }
    await next();
  };
}

/** Reads and parses a JSON body for mutating requests. Run after authentication. */
export const jsonBodyMiddleware: Middleware<HttpState> = async (context, next) => {
  const raw = await readLimited(context.req, MAX_BODY_BYTES);
  context.state.rawBody = raw;
  if (raw.length > 0) {
    const contentType = context.get('content-type').split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new ApiError(415, 'unsupported_media_type', 'Request bodies must be application/json.');
    }
    try {
      context.state.body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, 'bad_request', 'The request body is not valid JSON.');
    }
  } else {
    context.state.body = {};
  }
  await next();
};
