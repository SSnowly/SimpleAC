import { randomUUID } from 'node:crypto';
import type { Middleware } from 'koa';
import type { HttpState } from '../types.js';

// Matches the sac_actions.correlation_id column (VARCHAR(40)) so a caller-supplied
// request ID can be stored as the correlation ID of any action it causes.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

export const requestContextMiddleware: Middleware<HttpState> = async (context, next) => {
  const supplied = context.get('x-request-id');
  const requestId = REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
  context.state.requestId = requestId;
  context.set('x-request-id', requestId);
  await next();
};
