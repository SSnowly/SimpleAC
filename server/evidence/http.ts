import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface HttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: Buffer;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  body: Buffer;
}

/** Minimal HTTP client; FXServer's Node 16 has no global fetch. Injectable so storage can be tested offline. */
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

const MAX_RESPONSE_BYTES = 1024 * 1024;

export const defaultHttpClient: HttpClient = (input) =>
  new Promise((resolve, reject) => {
    const url = new URL(input.url);
    const send = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const request = send(
      url,
      {
        method: input.method,
        headers: {
          ...(input.body ? { 'content-length': String(input.body.length) } : {}),
          ...input.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
        response.on('error', reject);
      },
    );
    request.setTimeout(input.timeoutMs ?? 20_000, () => request.destroy(new Error('timed out')));
    request.on('error', reject);
    request.end(input.body);
  });
