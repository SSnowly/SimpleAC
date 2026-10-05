import type { Middleware } from 'koa';
import { type IdempotencyStore, requestFingerprint } from '../../services/idempotency.js';
import { ApiError } from '../errors.js';
import type { HttpState } from '../types.js';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Must run after authentication and after the JSON body has been read. */
export function idempotencyMiddleware(store: IdempotencyStore): Middleware<HttpState> {
  return async (context, next) => {
    const supplied = context.get('idempotency-key');
    const keyId = context.state.auth?.id;
    if (supplied === '' || !keyId) {
      await next();
      return;
    }
    if (!KEY_PATTERN.test(supplied)) {
      throw new ApiError(
        400,
        'validation_failed',
        'Idempotency-Key must be 8-128 characters of letters, digits, ".", "_", ":" or "-".',
      );
    }

    const fingerprint = requestFingerprint(
      context.method,
      context.path,
      context.state.rawBody ?? '',
    );
    const begin = await store.begin(keyId, supplied, fingerprint);

    if (begin.kind === 'replay') {
      context.status = begin.response.status;
      context.body = begin.response.body;
      context.set('idempotent-replayed', 'true');
      return;
    }
    if (begin.kind === 'reused') {
      throw new ApiError(
        422,
        'idempotency_key_reuse',
        'This Idempotency-Key was already used with a different request.',
      );
    }
    if (begin.kind === 'in_progress') {
      throw new ApiError(
        409,
        'idempotency_in_progress',
        'A request with this Idempotency-Key is still being processed.',
        { headers: { 'retry-after': '1' } },
      );
    }

    try {
      await next();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status < 500) {
        await store.complete(keyId, supplied, {
          status: error.status,
          body: {
            error: {
              code: error.code,
              message: error.message,
              requestId: context.state.requestId,
              ...(error.details === undefined ? {} : { details: error.details }),
            },
          },
        });
      } else {
        await store.abandon(keyId, supplied);
      }
      throw error;
    }
    if (context.status >= 500) {
      await store.abandon(keyId, supplied);
      return;
    }
    await store.complete(keyId, supplied, { status: context.status, body: context.body });
  };
}
