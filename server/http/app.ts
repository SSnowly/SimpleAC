import Koa from 'koa';
import type { HealthResponse } from '../../shared/contracts/health.js';
import type { ApiKeyService } from '../services/api-keys.js';
import type { BanService } from '../services/bans.js';
import type { CaptureService } from '../services/captures.js';
import type { CaseService } from '../services/cases.js';
import type { DetectionService } from '../services/detections.js';
import type { Directory } from '../services/directory.js';
import type { ExceptionService } from '../services/exceptions.js';
import type { IdempotencyStore } from '../services/idempotency.js';
import type { OverviewService } from '../services/overview.js';
import type { ProfileService } from '../services/profiles.js';
import { authMiddleware } from './middleware/auth.js';
import { bodyLimitMiddleware, MAX_BODY_BYTES } from './middleware/body.js';
import { errorMiddleware } from './middleware/errors.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import {
  createRateLimiter,
  type RateLimiter,
  rateLimitMiddleware,
} from './middleware/rate-limit.js';
import { requestContextMiddleware } from './middleware/request-context.js';
import { securityMiddleware } from './middleware/security.js';
import { createApiRouter } from './routes/api.js';
import { createUploadRouter } from './routes/captures.js';
import { createHealthRouter } from './routes/health.js';
import { createWebPanelRouter, type WebPanelDeps } from './routes/panel.js';
import type { HttpState } from './types.js';

export interface HttpAppDeps {
  panel?: WebPanelDeps;
  getHealth: () => Promise<HealthResponse>;
  keys: ApiKeyService;
  directory: Directory;
  bans: BanService;
  detections: DetectionService;
  cases: CaseService;
  exceptions: ExceptionService;
  profiles: ProfileService;
  overview: OverviewService;
  idempotency: IdempotencyStore;
  /** Screenshot evidence. Omitted when capture storage is not configured. */
  captures?: { service: CaptureService; maxUploadBytes: number; uploadLimiter?: RateLimiter };
  /** Per-key request budget. Defaults to 120 requests per minute with burst 60. */
  requestLimiter?: RateLimiter;
  /** Per-address budget for failed authentication attempts. */
  failureLimiter?: RateLimiter;
}

export function createHttpApp(deps: HttpAppDeps): Koa<HttpState> {
  const requestLimiter = deps.requestLimiter ?? createRateLimiter(60, 2);
  const failureLimiter = deps.failureLimiter ?? createRateLimiter(10, 10 / 60);

  const app = new Koa<HttpState>();
  app.proxy = false;
  app.use(errorMiddleware);
  app.use(requestContextMiddleware);
  app.use(securityMiddleware);
  app.use(bodyLimitMiddleware(deps.captures?.maxUploadBytes ?? MAX_BODY_BYTES));
  if (deps.panel) {
    const panel = createWebPanelRouter(deps.panel);
    app.use(panel.routes());
    app.use(panel.allowedMethods());
  }

  const health = createHealthRouter(deps.getHealth);
  app.use(health.routes());
  app.use(health.allowedMethods());

  if (deps.captures) {
    const upload = createUploadRouter({
      captures: deps.captures.service,
      maxBytes: deps.captures.maxUploadBytes,
      limiter: deps.captures.uploadLimiter ?? createRateLimiter(10, 0.5),
    });
    app.use(upload.routes());
  }

  const api = createApiRouter({
    directory: deps.directory,
    bans: deps.bans,
    detections: deps.detections,
    cases: deps.cases,
    exceptions: deps.exceptions,
    profiles: deps.profiles,
    overview: deps.overview,
    ...(deps.captures ? { captures: deps.captures.service } : {}),
    guard: [authMiddleware(deps.keys, failureLimiter), rateLimitMiddleware(requestLimiter)],
    mutationGuard: [idempotencyMiddleware(deps.idempotency)],
  });
  app.use(api.routes());
  app.use(api.allowedMethods());

  app.use((context) => {
    context.status = 404;
    context.body = {
      error: {
        code: 'not_found',
        message: 'The requested endpoint does not exist.',
        requestId: context.state.requestId,
      },
    };
  });
  app.on('error', (error: Error, context?: Koa.Context) => {
    const requestId: unknown = context?.state['requestId'];
    console.error(
      JSON.stringify({ level: 'error', event: 'koa_error', requestId, error: error.message }),
    );
  });
  return app;
}
