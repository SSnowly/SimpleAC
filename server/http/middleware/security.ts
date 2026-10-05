import type { Middleware } from 'koa';
import type { HttpState } from '../types.js';

export const securityMiddleware: Middleware<HttpState> = async (context, next) => {
  context.set('cache-control', 'no-store');
  context.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  context.set('referrer-policy', 'no-referrer');
  context.set('x-content-type-options', 'nosniff');
  context.set('x-frame-options', 'DENY');
  await next();
};
