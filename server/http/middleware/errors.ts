import type { Middleware } from 'koa';
import { ZodError } from 'zod';
import { ApiError } from '../errors.js';
import type { HttpState } from '../types.js';

export const errorMiddleware: Middleware<HttpState> = async (context, next) => {
  try {
    await next();
  } catch (error: unknown) {
    const requestId = context.state.requestId;

    if (error instanceof ApiError) {
      for (const [name, value] of Object.entries(error.headers)) context.set(name, value);
      context.status = error.status;
      context.body = {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      };
      return;
    }

    const normalized = error instanceof Error ? error : new Error('Unknown HTTP failure');
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'http_request_failed',
        requestId,
        method: context.method,
        path: context.path,
        error: normalized.message,
      }),
    );
    context.status = 500;
    context.body = {
      error: {
        code: error instanceof ZodError ? 'invalid_server_response' : 'internal_error',
        message: 'The request could not be completed.',
        requestId,
      },
    };
  }
};
