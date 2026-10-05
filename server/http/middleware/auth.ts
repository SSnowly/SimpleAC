import type { Middleware } from 'koa';
import type { ApiScope } from '../../../shared/contracts/api.js';
import { hasScope } from '../../security/scopes.js';
import type { ApiKeyService } from '../../services/api-keys.js';
import { forbidden, unauthenticated } from '../errors.js';
import type { HttpState } from '../types.js';
import { type RateLimiter, rateLimited } from './rate-limit.js';

const BEARER = /^Bearer ([^\s]+)$/i;

export function authMiddleware(
  keys: ApiKeyService,
  failureLimiter: RateLimiter,
): Middleware<HttpState> {
  return async (context, next) => {
    const header = context.get('authorization');
    const token = BEARER.exec(header)?.[1];
    const key = token ? await keys.authenticate(token) : null;

    if (!key) {
      // Failed attempts are throttled per remote address; successful callers are not.
      const retryAfter = failureLimiter.take(context.ip);
      if (retryAfter > 0) throw rateLimited(retryAfter);
      throw unauthenticated();
    }
    if (key.allowedIps.length > 0 && !key.allowedIps.includes(context.ip)) throw forbidden();

    context.state.auth = { id: key.id, name: key.name, scopes: key.scopes };
    await next();
  };
}

export function requireScope(scope: ApiScope): Middleware<HttpState> {
  return async (context, next) => {
    const auth = context.state.auth;
    if (!auth || !hasScope(auth.scopes, scope)) throw forbidden();
    await next();
  };
}
