import type { Middleware } from 'koa';
import { ApiError } from '../errors.js';
import type { HttpState } from '../types.js';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiter {
  /** Returns 0 when the call is allowed, otherwise the seconds until a token is available. */
  take(key: string): number;
}

export function createRateLimiter(
  capacity: number,
  refillPerSecond: number,
  now: () => number = Date.now,
): RateLimiter {
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();

  return {
    take(key) {
      const current = now();
      if (current - lastSweep > 60_000) {
        lastSweep = current;
        for (const [bucketKey, bucket] of buckets) {
          if (current - bucket.updatedAt > 120_000) buckets.delete(bucketKey);
        }
      }
      const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: current };
      bucket.tokens = Math.min(
        capacity,
        bucket.tokens + ((current - bucket.updatedAt) / 1000) * refillPerSecond,
      );
      bucket.updatedAt = current;
      buckets.set(key, bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return 0;
      }
      return Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond));
    },
  };
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, 'rate_limited', 'Too many requests.', {
    headers: { 'retry-after': String(retryAfterSeconds) },
  });
}

export function rateLimitMiddleware(limiter: RateLimiter): Middleware<HttpState> {
  return async (context, next) => {
    const key = context.state.auth?.id ?? context.ip;
    const retryAfter = limiter.take(key);
    if (retryAfter > 0) throw rateLimited(retryAfter);
    await next();
  };
}
