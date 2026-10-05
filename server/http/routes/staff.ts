import type Router from '@koa/router';
import type { RouterMiddleware } from '@koa/router';
import { z } from 'zod';
import {
  type ApiScope,
  addCaseNoteRequestSchema,
  caseDetailSchema,
  caseSchema,
  createCaseRequestSchema,
  createExceptionRequestSchema,
  detectionDetailSchema,
  detectionSchema,
  detectionStatusSchema,
  exceptionSchema,
  exceptionScopeSchema,
  linkCaptureRequestSchema,
  linkDetectionRequestSchema,
  listSchema,
  overviewSchema,
  pageQuerySchema,
  profileDetailSchema,
  profileSchema,
  revokeExceptionRequestSchema,
  updateCaseRequestSchema,
  updateDetectionRequestSchema,
} from '../../../shared/contracts/api.js';
import { simpleAcIdSchema } from '../../../shared/contracts/ids.js';
import type { CaseService } from '../../services/cases.js';
import type { DetectionService } from '../../services/detections.js';
import type { ExceptionService } from '../../services/exceptions.js';
import type { OverviewService } from '../../services/overview.js';
import type { ProfileService } from '../../services/profiles.js';
import { forbidden, notFound } from '../errors.js';
import type { HttpState } from '../types.js';
import { parseRequest } from '../validate.js';

export interface StaffRouteDeps {
  detections: DetectionService;
  cases: CaseService;
  exceptions: ExceptionService;
  profiles: ProfileService;
  overview: OverviewService;
}

export interface RouteBuilders {
  read: (scope: ApiScope, handler: RouterMiddleware<HttpState>) => RouterMiddleware<HttpState>[];
  write: (scope: ApiScope, handler: RouterMiddleware<HttpState>) => RouterMiddleware<HttpState>[];
  idParam: (prefix: string) => z.ZodType<string>;
}

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export function registerStaffRoutes(
  router: Router<HttpState>,
  { read, write, idParam }: RouteBuilders,
  { detections, cases, exceptions, profiles, overview }: StaffRouteDeps,
): void {
  const actorOf = (context: { state: HttpState }) => {
    const auth = context.state.auth;
    if (!auth) throw forbidden();
    return { keyId: auth.id, correlationId: context.state.requestId };
  };

  router.get(
    '/overview',
    ...read('detections:read', async (context) => {
      context.body = overviewSchema.parse(await overview.get());
    }),
  );

  // --- Detections ---
  const detectionsQuery = pageQuerySchema.extend({
    playerId: idParam('SAC-PLY').optional(),
    caseId: idParam('SAC-CASE').optional(),
    ruleKey: z
      .string()
      .regex(/^[a-z][a-z0-9_.]{0,127}$/)
      .optional(),
    category: optionalText(64),
    status: detectionStatusSchema.optional(),
  });
  router.get(
    '/detections',
    ...read('detections:read', async (context) => {
      const query = parseRequest(detectionsQuery, context.query);
      const result = await detections.list({
        limit: query.limit,
        ...(query.playerId ? { playerId: query.playerId } : {}),
        ...(query.caseId ? { caseId: query.caseId } : {}),
        ...(query.ruleKey ? { ruleKey: query.ruleKey } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.before ? { before: query.before } : {}),
      });
      context.body = listSchema(detectionSchema).parse(result);
    }),
  );

  router.get(
    '/detections/:id',
    ...read('detections:read', async (context) => {
      const id = parseRequest(idParam('SAC-DET'), context.params['id']);
      const detection = await detections.get(id);
      if (!detection) throw notFound('The detection does not exist.');
      context.body = detectionDetailSchema.parse(detection);
    }),
  );

  router.post(
    '/detections/:id/review',
    ...write('detections:write', async (context) => {
      const id = parseRequest(idParam('SAC-DET'), context.params['id']);
      const input = parseRequest(updateDetectionRequestSchema, context.state.body);
      context.body = detectionDetailSchema.parse(
        await detections.review(id, input, actorOf(context)),
      );
    }),
  );

  // --- Cases ---
  const casesQuery = pageQuerySchema.extend({
    playerId: idParam('SAC-PLY').optional(),
    status: z.enum(['open', 'investigating', 'closed']).optional(),
    assignedTo: optionalText(128),
  });
  router.get(
    '/cases',
    ...read('cases:read', async (context) => {
      const query = parseRequest(casesQuery, context.query);
      const result = await cases.list({
        limit: query.limit,
        ...(query.playerId ? { playerId: query.playerId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}),
        ...(query.before ? { before: query.before } : {}),
      });
      context.body = listSchema(caseSchema).parse(result);
    }),
  );

  router.get(
    '/cases/:id',
    ...read('cases:read', async (context) => {
      const id = parseRequest(idParam('SAC-CASE'), context.params['id']);
      const record = await cases.get(id);
      if (!record) throw notFound('The case does not exist.');
      context.body = caseDetailSchema.parse(record);
    }),
  );

  router.post(
    '/cases',
    ...write('cases:write', async (context) => {
      const input = parseRequest(createCaseRequestSchema, context.state.body);
      context.status = 201;
      context.body = caseDetailSchema.parse(await cases.create(input, actorOf(context)));
    }),
  );

  router.post(
    '/cases/:id/update',
    ...write('cases:write', async (context) => {
      const id = parseRequest(idParam('SAC-CASE'), context.params['id']);
      const input = parseRequest(updateCaseRequestSchema, context.state.body);
      context.body = caseDetailSchema.parse(await cases.update(id, input, actorOf(context)));
    }),
  );

  router.post(
    '/cases/:id/notes',
    ...write('cases:write', async (context) => {
      const id = parseRequest(idParam('SAC-CASE'), context.params['id']);
      const input = parseRequest(addCaseNoteRequestSchema, context.state.body);
      context.status = 201;
      context.body = caseDetailSchema.parse(await cases.addNote(id, input.note, actorOf(context)));
    }),
  );

  router.post(
    '/cases/:id/detections',
    ...write('cases:write', async (context) => {
      const id = parseRequest(idParam('SAC-CASE'), context.params['id']);
      const input = parseRequest(linkDetectionRequestSchema, context.state.body);
      context.body = caseDetailSchema.parse(
        await cases.linkDetection(id, input.detectionId, actorOf(context)),
      );
    }),
  );

  router.post(
    '/cases/:id/captures',
    ...write('cases:write', async (context) => {
      const id = parseRequest(idParam('SAC-CASE'), context.params['id']);
      const input = parseRequest(linkCaptureRequestSchema, context.state.body);
      context.body = caseDetailSchema.parse(
        await cases.linkCapture(id, input.captureId, actorOf(context)),
      );
    }),
  );

  // --- Exceptions ---
  const exceptionsQuery = pageQuerySchema.extend({
    scopeType: exceptionScopeSchema.optional(),
    scopeValue: optionalText(255),
    active: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  });
  router.get(
    '/exceptions',
    ...read('exceptions:read', async (context) => {
      const query = parseRequest(exceptionsQuery, context.query);
      const result = await exceptions.list({
        activeOnly: query.active,
        limit: query.limit,
        ...(query.scopeType ? { scopeType: query.scopeType } : {}),
        ...(query.scopeValue ? { scopeValue: query.scopeValue } : {}),
        ...(query.before ? { before: query.before } : {}),
      });
      context.body = listSchema(exceptionSchema).parse(result);
    }),
  );

  router.get(
    '/exceptions/:id',
    ...read('exceptions:read', async (context) => {
      const id = parseRequest(idParam('SAC-EXC'), context.params['id']);
      const record = await exceptions.get(id);
      if (!record) throw notFound('The exception does not exist.');
      context.body = exceptionSchema.parse(record);
    }),
  );

  router.post(
    '/exceptions',
    ...write('exceptions:write', async (context) => {
      const input = parseRequest(createExceptionRequestSchema, context.state.body);
      context.status = 201;
      context.body = exceptionSchema.parse(await exceptions.create(input, actorOf(context)));
    }),
  );

  router.post(
    '/exceptions/:id/revoke',
    ...write('exceptions:write', async (context) => {
      const id = parseRequest(idParam('SAC-EXC'), context.params['id']);
      const input = parseRequest(revokeExceptionRequestSchema, context.state.body);
      context.body = exceptionSchema.parse(
        await exceptions.revoke(id, input.reason, actorOf(context)),
      );
    }),
  );

  // --- Profiles (read-only: the engine runs the bundled profile and records its versions) ---
  router.get(
    '/profiles',
    ...read('profiles:read', async (context) => {
      context.body = { items: z.array(profileSchema).parse(await profiles.list()) };
    }),
  );

  const profileQuery = z.object({ version: simpleAcIdSchema.optional() });
  router.get(
    '/profiles/:id',
    ...read('profiles:read', async (context) => {
      const id = parseRequest(idParam('SAC-PRF'), context.params['id']);
      const query = parseRequest(profileQuery, context.query);
      const profile = await profiles.get(id, query.version);
      if (!profile) throw notFound('The profile does not exist.');
      context.body = profileDetailSchema.parse(profile);
    }),
  );
}
