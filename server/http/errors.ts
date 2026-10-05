import type { ApiErrorCode } from '../../shared/contracts/api.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'A valid API key is required.', {
    headers: { 'www-authenticate': 'Bearer' },
  });

export const forbidden = (message = 'The API key does not grant access to this operation.') =>
  new ApiError(403, 'forbidden', message);

export const notFound = (message = 'The requested record does not exist.'): ApiError =>
  new ApiError(404, 'not_found', message);

export const conflict = (message: string): ApiError => new ApiError(409, 'conflict', message);
