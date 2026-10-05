import Router from '@koa/router';
import type { CaptureService } from '../../services/captures.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { readBuffer, UPLOAD_PATH_PREFIX } from '../middleware/body.js';
import { type RateLimiter, rateLimited } from '../middleware/rate-limit.js';
import type { HttpState } from '../types.js';

export interface UploadRouterDeps {
  captures: CaptureService;
  maxBytes: number;
  limiter: RateLimiter;
}

// The NUI page is served from https://cfx-nui-<resource>/ and uploads cross-origin to the resource's HTTP endpoint.
const NUI_ORIGIN = /^https?:\/\/cfx-nui-[A-Za-z0-9._-]+$/;
const TOKEN = /^[0-9a-f]{64}$/;

function allowNuiOrigin(origin: string, headers: (name: string, value: string) => void): boolean {
  if (!NUI_ORIGIN.test(origin)) return false;
  headers('access-control-allow-origin', origin);
  headers('vary', 'Origin');
  return true;
}

/**
 * Single-use screenshot uploads. The token in the path is the only credential: it is minted per request by the
 * server, valid for one upload within a short window, and stored only as a hash.
 */
export function createUploadRouter(deps: UploadRouterDeps): Router<HttpState> {
  const router = new Router<HttpState>();
  const path = `${UPLOAD_PATH_PREFIX}:token`;

  router.options(path, (context) => {
    if (allowNuiOrigin(context.get('origin'), (name, value) => context.set(name, value))) {
      context.set('access-control-allow-methods', 'POST, OPTIONS');
      context.set('access-control-allow-headers', 'content-type');
      context.set('access-control-max-age', '600');
    }
    context.status = 204;
  });

  router.post(path, async (context) => {
    allowNuiOrigin(context.get('origin'), (name, value) => context.set(name, value));

    const retryAfter = deps.limiter.take(context.ip);
    if (retryAfter > 0) throw rateLimited(retryAfter);

    const token = context.params['token'];
    if (typeof token !== 'string' || !TOKEN.test(token))
      throw notFound('The upload token is not valid.');

    const bytes = await readBuffer(context.req, deps.maxBytes);
    if (bytes.length === 0) throw new ApiError(400, 'bad_request', 'The upload body is empty.');

    const result = await deps.captures.receiveUpload({
      token,
      bytes,
      contentType: context.get('content-type') || undefined,
    });
    context.status = 201;
    context.body = { id: result.id };
  });

  // Anything else on the upload path (GET, PUT, ...) is rejected rather than falling through to the 404 handler.
  router.all(path, () => {
    throw forbidden('Only POST uploads are accepted here.');
  });
  return router;
}
