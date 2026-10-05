import Router, { type RouterMiddleware } from '@koa/router';
import type { Middleware } from 'koa';
import { z } from 'zod';
import {
  type ApiScope,
  actionSchema,
  banSchema,
  captureDetailSchema,
  captureRequestResultSchema,
  captureSchema,
  captureStatusSchema,
  createBanRequestSchema,
  createCaptureRequestSchema,
  identityLinkSchema,
  listSchema,
  lookupResultSchema,
  ocrRulesSchema,
  pageQuerySchema,
  playerDetailSchema,
  playerSummarySchema,
  rescanResultSchema,
  revokeBanRequestSchema,
} from '../../../shared/contracts/api.js';
import { simpleAcIdSchema } from '../../../shared/contracts/ids.js';
import { hasScope } from '../../security/scopes.js';
import type { BanService } from '../../services/bans.js';
import type { CaptureService } from '../../services/captures.js';
import type { CaseService } from '../../services/cases.js';
import type { DetectionService } from '../../services/detections.js';
import type { Directory } from '../../services/directory.js';
import type { ExceptionService } from '../../services/exceptions.js';
import type { OverviewService } from '../../services/overview.js';
import type { ProfileService } from '../../services/profiles.js';
import { forbidden, notFound } from '../errors.js';
import { requireScope } from '../middleware/auth.js';
import { jsonBodyMiddleware } from '../middleware/body.js';
import type { HttpState } from '../types.js';
import { parseRequest } from '../validate.js';
import { registerStaffRoutes } from './staff.js';

export interface ApiRouterDeps {
  directory: Directory;
  bans: BanService;
  /** Screenshot evidence routes are only registered when this is provided. */
  captures?: CaptureService;
  detections: DetectionService;
  cases: CaseService;
  exceptions: ExceptionService;
  profiles: ProfileService;
  overview: OverviewService;
  /** Runs before each route: authentication and rate limiting. */
  guard: Middleware<HttpState>[];
  /** Runs for mutations after the body is parsed: idempotency. */
  mutationGuard: Middleware<HttpState>[];
}

const idParam = (prefix: string) =>
  simpleAcIdSchema.refine((value) => value.startsWith(`${prefix}-`), 'wrong identifier type');

export function createApiRouter(deps: ApiRouterDeps): Router<HttpState> {
  const router = new Router<HttpState>({ prefix: '/v1' });
  const { directory, bans, captures } = deps;

  const read = (
    scope: ApiScope,
    handler: RouterMiddleware<HttpState>,
  ): RouterMiddleware<HttpState>[] => [...deps.guard, requireScope(scope), handler];
  const write = (
    scope: ApiScope,
    handler: RouterMiddleware<HttpState>,
  ): RouterMiddleware<HttpState>[] => [
    ...deps.guard,
    requireScope(scope),
    jsonBodyMiddleware,
    ...deps.mutationGuard,
    handler,
  ];

  const playersQuery = pageQuerySchema.extend({ q: z.string().trim().min(1).max(128).optional() });
  router.get(
    '/players',
    ...read('players:read', async (context) => {
      const query = parseRequest(playersQuery, context.query);
      const result = await directory.listPlayers({
        limit: query.limit,
        ...(query.q ? { query: query.q } : {}),
        ...(query.before ? { before: query.before } : {}),
      });
      context.body = listSchema(playerSummarySchema).parse(result);
    }),
  );

  router.get(
    '/players/:id',
    ...read('players:read', async (context) => {
      const id = parseRequest(idParam('SAC-PLY'), context.params['id']);
      const includeIdentifiers = hasScope(context.state.auth?.scopes ?? [], 'identifiers:read');
      const player = await directory.getPlayer(id, includeIdentifiers);
      if (!player) throw notFound('The player does not exist.');
      context.body = playerDetailSchema.parse(player);
    }),
  );

  router.get(
    '/players/:id/links',
    ...read('identifiers:read', async (context) => {
      const id = parseRequest(idParam('SAC-PLY'), context.params['id']);
      if (!(await directory.getPlayer(id, false))) throw notFound('The player does not exist.');
      const links = await directory.listIdentityLinks(id);
      context.body = { items: z.array(identityLinkSchema).parse(links) };
    }),
  );

  const actionsQuery = pageQuerySchema.extend({
    targetId: z.string().max(128).optional(),
    actionType: z.string().max(64).optional(),
  });
  router.get(
    '/actions',
    ...read('actions:read', async (context) => {
      const query = parseRequest(actionsQuery, context.query);
      const result = await directory.listActions({
        limit: query.limit,
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(query.actionType ? { actionType: query.actionType } : {}),
        ...(query.before ? { before: query.before } : {}),
      });
      context.body = listSchema(actionSchema).parse(result);
    }),
  );

  router.get(
    '/actions/:id',
    ...read('actions:read', async (context) => {
      const id = parseRequest(idParam('SAC-ACT'), context.params['id']);
      const action = await directory.getAction(id);
      if (!action) throw notFound('The action does not exist.');
      context.body = actionSchema.parse(action);
    }),
  );

  const bansQuery = pageQuerySchema.extend({
    playerId: idParam('SAC-PLY').optional(),
    active: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  });
  router.get(
    '/bans',
    ...read('bans:read', async (context) => {
      const query = parseRequest(bansQuery, context.query);
      const result = await directory.listBans({
        activeOnly: query.active,
        limit: query.limit,
        ...(query.playerId ? { playerId: query.playerId } : {}),
        ...(query.before ? { before: query.before } : {}),
      });
      context.body = listSchema(banSchema).parse(result);
    }),
  );

  router.get(
    '/bans/:id',
    ...read('bans:read', async (context) => {
      const id = parseRequest(idParam('SAC-BAN'), context.params['id']);
      const ban = await directory.getBan(id);
      if (!ban) throw notFound('The ban does not exist.');
      context.body = banSchema.parse(ban);
    }),
  );

  router.post(
    '/bans',
    ...write('bans:write', async (context) => {
      const input = parseRequest(createBanRequestSchema, context.state.body);
      const auth = context.state.auth;
      if (!auth) throw forbidden();
      const ban = await bans.create(input, {
        keyId: auth.id,
        correlationId: context.state.requestId,
      });
      context.status = 201;
      context.body = banSchema.parse(ban);
    }),
  );

  router.post(
    '/bans/:id/revoke',
    ...write('bans:write', async (context) => {
      const id = parseRequest(idParam('SAC-BAN'), context.params['id']);
      const input = parseRequest(revokeBanRequestSchema, context.state.body);
      const auth = context.state.auth;
      if (!auth) throw forbidden();
      const ban = await bans.revoke(id, input.reason, {
        keyId: auth.id,
        correlationId: context.state.requestId,
      });
      context.body = banSchema.parse(ban);
    }),
  );

  if (captures) {
    const capturesQuery = pageQuerySchema.extend({
      playerId: idParam('SAC-PLY').optional(),
      caseId: idParam('SAC-CASE').optional(),
      status: captureStatusSchema.optional(),
      trigger: z
        .string()
        .regex(/^[a-z_]{1,16}$/)
        .optional(),
      ocr: z.enum(['matched']).optional(),
    });
    router.get(
      '/captures',
      ...read('captures:read', async (context) => {
        const query = parseRequest(capturesQuery, context.query);
        const result = await captures.list({
          limit: query.limit,
          ...(query.playerId ? { playerId: query.playerId } : {}),
          ...(query.caseId ? { caseId: query.caseId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.trigger ? { trigger: query.trigger } : {}),
          ...(query.ocr === 'matched' ? { ocrMatched: true } : {}),
          ...(query.before ? { before: query.before } : {}),
        });
        context.body = listSchema(captureSchema).parse(result);
      }),
    );

    router.get(
      '/captures/:id',
      ...read('captures:read', async (context) => {
        const id = parseRequest(idParam('SAC-CAP'), context.params['id']);
        const capture = await captures.get(id);
        if (!capture) throw notFound('The capture does not exist.');
        context.body = captureDetailSchema.parse(capture);
      }),
    );

    router.get(
      '/captures/:id/image',
      ...read('captures:read', async (context) => {
        const id = parseRequest(idParam('SAC-CAP'), context.params['id']);
        const image = await captures.openImage(id);
        if (!image) throw notFound('The capture has no stored image.');
        if (image.kind === 'redirect') {
          context.redirect(image.url);
          return;
        }
        context.set('cache-control', 'private, max-age=300');
        context.type = image.mediaType;
        context.body = image.bytes;
      }),
    );

    router.get(
      '/ocr/rules',
      ...read('captures:read', (context) => {
        context.body = ocrRulesSchema.parse(captures.ocrRules());
      }),
    );

    router.post(
      '/captures/:id/rescan',
      ...write('captures:write', async (context) => {
        const id = parseRequest(idParam('SAC-CAP'), context.params['id']);
        const auth = context.state.auth;
        if (!auth) throw forbidden();
        const result = await captures.rescan(id, {
          keyId: auth.id,
          correlationId: context.state.requestId,
        });
        context.status = 202;
        context.body = rescanResultSchema.parse(result);
      }),
    );

    router.post(
      '/captures/:id/delete',
      ...write('captures:write', async (context) => {
        const id = parseRequest(idParam('SAC-CAP'), context.params['id']);
        const input = parseRequest(revokeBanRequestSchema, context.state.body);
        const auth = context.state.auth;
        if (!auth) throw forbidden();
        await captures.remove(id, input.reason, {
          keyId: auth.id,
          correlationId: context.state.requestId,
        });
        context.status = 204;
      }),
    );

    router.post(
      '/players/:id/captures',
      ...write('captures:write', async (context) => {
        const id = parseRequest(idParam('SAC-PLY'), context.params['id']);
        const input = parseRequest(createCaptureRequestSchema, context.state.body);
        const auth = context.state.auth;
        if (!auth) throw forbidden();
        const result = await captures.request(id, input, {
          keyId: auth.id,
          correlationId: context.state.requestId,
        });
        context.status = 202;
        context.body = captureRequestResultSchema.parse(result);
      }),
    );
  }

  registerStaffRoutes(
    router,
    { read, write, idParam },
    {
      detections: deps.detections,
      cases: deps.cases,
      exceptions: deps.exceptions,
      profiles: deps.profiles,
      overview: deps.overview,
    },
  );

  const lookupQuery = z.object({ q: z.string().trim().min(3).max(255) });
  router.get('/lookup', ...deps.guard, async (context) => {
    const { q } = parseRequest(lookupQuery, context.query);
    const result = await directory.lookup(q);
    if (!result) throw notFound('No record matches that identifier.');
    if (!hasScope(context.state.auth?.scopes ?? [], result.requiredScope)) throw forbidden();
    context.body = lookupResultSchema.parse({
      type: result.type,
      id: result.id,
      record: result.record,
    });
  });

  return router;
}
