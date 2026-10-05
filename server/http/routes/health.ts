import Router from '@koa/router';
import type Koa from 'koa';
import { type HealthResponse, healthResponseSchema } from '../../../shared/contracts/health.js';
import type { HttpState } from '../types.js';

export function createHealthRouter(getHealth: () => Promise<HealthResponse>): Router<HttpState> {
  const router = new Router<HttpState>();

  async function respond(context: Koa.ParameterizedContext<HttpState>): Promise<void> {
    const response = healthResponseSchema.parse(await getHealth());
    context.status = response.status === 'ready' ? 200 : 503;
    context.body = response;
  }

  router.get('/health', respond);
  router.get('/v1/health', respond);
  return router;
}
