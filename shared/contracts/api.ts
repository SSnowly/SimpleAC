import { z } from 'zod';
import { simpleAcIdSchema } from './id-schema.js';

export const apiScopes = [
  'admin',
  'players:read',
  'identifiers:read',
  'actions:read',
  'detections:read',
  'detections:write',
  'cases:read',
  'cases:write',
  'exceptions:read',
  'exceptions:write',
  'profiles:read',
  'bans:read',
  'bans:write',
  'captures:read',
  'captures:write',
  'keys:read',
] as const;

export type ApiScope = (typeof apiScopes)[number];
export const apiScopeSchema = z.enum(apiScopes);

export const apiErrorCodes = [
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'idempotency_key_reuse',
  'idempotency_in_progress',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'unavailable',
  'internal_error',
  'invalid_server_response',
] as const;

export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(apiErrorCodes),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export const isoTimestampSchema = z.iso.datetime();

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: simpleAcIdSchema.optional(),
});

export const playerSummarySchema = z.object({
  id: simpleAcIdSchema,
  displayName: z.string().nullable(),
  riskScore: z.number(),
  firstSeenAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
});

export const playerIdentifierSchema = z.object({
  type: z.string(),
  key: z.string(),
  firstSeenAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
});

export const sessionSummarySchema = z.object({
  id: simpleAcIdSchema,
  connectedAt: isoTimestampSchema,
  disconnectedAt: isoTimestampSchema.nullable(),
  disconnectReason: z.string().nullable(),
});

export const banSchema = z.object({
  id: simpleAcIdSchema,
  playerId: simpleAcIdSchema,
  actionId: simpleAcIdSchema,
  reason: z.string(),
  expiresAt: isoTimestampSchema.nullable(),
  revokedByActionId: simpleAcIdSchema.nullable(),
  active: z.boolean(),
  createdAt: isoTimestampSchema,
});

export const playerDetailSchema = playerSummarySchema.extend({
  identifiers: z.array(playerIdentifierSchema).optional(),
  recentSessions: z.array(sessionSummarySchema),
  bans: z.array(banSchema),
});

export const identitySignalSchema = z.object({
  signal: z.string(),
  weight: z.number(),
});

/** A scored link between two player identities, with every signal that contributed to the score. */
export const identityLinkSchema = z.object({
  id: z.string(),
  playerId: simpleAcIdSchema,
  score: z.number(),
  signals: z.array(identitySignalSchema),
  otherBanned: z.boolean(),
  createdAt: isoTimestampSchema,
});

export const captureStatusSchema = z.enum([
  'requested',
  'uploading',
  'uploaded',
  'failed',
  'expired',
]);

export const ocrMatchSchema = z.object({
  rule: z.string(),
  kind: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  term: z.string(),
});

export const ocrResultSchema = z.object({
  id: simpleAcIdSchema,
  ruleVersion: z.string(),
  text: z.string(),
  matches: z.array(ocrMatchSchema),
  confidence: z.number().nullable(),
  durationMs: z.number(),
  createdAt: isoTimestampSchema,
});

export const captureSchema = z.object({
  id: simpleAcIdSchema,
  playerId: simpleAcIdSchema,
  detectionId: simpleAcIdSchema.nullable(),
  caseId: simpleAcIdSchema.nullable(),
  status: captureStatusSchema,
  trigger: z.string(),
  requestedBy: z.string(),
  mediaType: z.string().nullable(),
  byteSize: z.number().nullable(),
  sha256: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  storageBackend: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: isoTimestampSchema,
  uploadedAt: isoTimestampSchema.nullable(),
});

export const captureDetailSchema = captureSchema.extend({
  ocr: z.array(ocrResultSchema),
});

export const createCaptureRequestSchema = z.object({
  reason: z.string().trim().min(3).max(512),
  encoding: z.enum(['jpg', 'webp', 'png']).optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  burst: z
    .object({
      count: z.number().int().min(2).max(5),
      intervalMs: z.number().int().min(500).max(10_000),
    })
    .optional(),
});

export const captureRequestResultSchema = z.object({
  ids: z.array(simpleAcIdSchema),
});

export const actionSchema = z.object({
  id: simpleAcIdSchema,
  correlationId: z.string(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  actionType: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  origin: z.string(),
  reversesActionId: simpleAcIdSchema.nullable(),
  createdAt: isoTimestampSchema,
});

export const createBanRequestSchema = z.object({
  playerId: simpleAcIdSchema,
  reason: z.string().trim().min(3).max(512),
  durationHours: z.number().int().min(1).max(87_600).nullable().default(null),
});

export const revokeBanRequestSchema = z.object({
  reason: z.string().trim().min(3).max(512),
});

export const lookupResultSchema = z.object({
  type: z.string(),
  id: z.string(),
  record: z.unknown(),
});

export function listSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextBefore: simpleAcIdSchema.nullable() });
}

export type PlayerSummary = z.infer<typeof playerSummarySchema>;
export type PlayerDetail = z.infer<typeof playerDetailSchema>;
export type Ban = z.infer<typeof banSchema>;
export type IdentityLink = z.infer<typeof identityLinkSchema>;
export type ApiAction = z.infer<typeof actionSchema>;
export type CreateBanRequest = z.infer<typeof createBanRequestSchema>;
export type Capture = z.infer<typeof captureSchema>;
export type CaptureDetail = z.infer<typeof captureDetailSchema>;
export type CreateCaptureRequest = z.infer<typeof createCaptureRequestSchema>;

// --- Detections, cases, exceptions, profiles and the overview (staff panels) ---

export const detectionStatusSchema = z.enum(['open', 'confirmed', 'dismissed']);

export const detectionSchema = z.object({
  id: simpleAcIdSchema,
  playerId: simpleAcIdSchema,
  sessionId: simpleAcIdSchema.nullable(),
  caseId: simpleAcIdSchema.nullable(),
  ruleKey: z.string(),
  ruleVersion: z.number(),
  category: z.string(),
  severity: z.number(),
  confidence: z.number(),
  score: z.number(),
  outcome: z.string(),
  status: z.string(),
  occurredAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
});

export const detectionEvidenceSchema = z.object({
  type: z.string(),
  referenceId: z.string().nullable(),
  payload: z.unknown(),
  createdAt: isoTimestampSchema,
});

export const detectionDetailSchema = detectionSchema.extend({
  measured: z.record(z.string(), z.unknown()),
  evidence: z.array(detectionEvidenceSchema),
  captures: z.array(captureSchema),
});

export const updateDetectionRequestSchema = z.object({
  status: detectionStatusSchema,
  reason: z.string().trim().min(3).max(512),
});

export const caseStatusSchema = z.enum(['open', 'investigating', 'closed']);

export const caseSchema = z.object({
  id: simpleAcIdSchema,
  playerId: simpleAcIdSchema,
  status: z.string(),
  priority: z.number(),
  title: z.string(),
  assignedTo: z.string().nullable(),
  detectionCount: z.number(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const caseEventSchema = z.object({
  id: z.number(),
  actionId: simpleAcIdSchema.nullable(),
  type: z.string(),
  actor: z.string(),
  body: z.record(z.string(), z.unknown()),
  createdAt: isoTimestampSchema,
});

export const caseDetailSchema = caseSchema.extend({
  detections: z.array(detectionSchema),
  events: z.array(caseEventSchema),
  captures: z.array(captureSchema),
});

export const createCaseRequestSchema = z.object({
  playerId: simpleAcIdSchema,
  title: z.string().trim().min(3).max(255),
  priority: z.number().int().min(0).max(100).default(0),
  reason: z.string().trim().min(3).max(512),
});

export const updateCaseRequestSchema = z
  .object({
    status: caseStatusSchema.optional(),
    priority: z.number().int().min(0).max(100).optional(),
    assignedTo: z.string().trim().min(1).max(128).nullable().optional(),
    reason: z.string().trim().min(3).max(512),
  })
  .refine(
    (value) =>
      value.status !== undefined || value.priority !== undefined || value.assignedTo !== undefined,
    'Nothing to change.',
  );

export const addCaseNoteRequestSchema = z.object({
  note: z.string().trim().min(1).max(4000),
});

export const linkDetectionRequestSchema = z.object({ detectionId: simpleAcIdSchema });
export const linkCaptureRequestSchema = z.object({ captureId: simpleAcIdSchema });

export const exceptionScopeSchema = z.enum(['player', 'detection', 'resource']);
export const exceptionEffectSchema = z.enum(['allow', 'ignore']);

export const exceptionSchema = z.object({
  id: simpleAcIdSchema,
  scopeType: z.string(),
  scopeValue: z.string(),
  effect: z.string(),
  reason: z.string(),
  createdBy: z.string(),
  expiresAt: isoTimestampSchema.nullable(),
  revokedByActionId: simpleAcIdSchema.nullable(),
  active: z.boolean(),
  createdAt: isoTimestampSchema,
});

export const createExceptionRequestSchema = z.object({
  scopeType: exceptionScopeSchema,
  scopeValue: z.string().trim().min(1).max(255),
  effect: exceptionEffectSchema.default('allow'),
  reason: z.string().trim().min(3).max(512),
  durationHours: z.number().int().min(1).max(87_600).nullable().default(null),
});

export const revokeExceptionRequestSchema = z.object({
  reason: z.string().trim().min(3).max(512),
});

export const profileSchema = z.object({
  id: simpleAcIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  activeVersionId: simpleAcIdSchema.nullable(),
  activeVersion: z.number().nullable(),
  versionCount: z.number(),
  createdAt: isoTimestampSchema,
});

export const profileVersionSchema = z.object({
  id: simpleAcIdSchema,
  version: z.number(),
  createdBy: z.string(),
  createdAt: isoTimestampSchema,
});

export const profileDetailSchema = profileSchema.extend({
  versions: z.array(profileVersionSchema),
  config: z.record(z.string(), z.unknown()).nullable(),
});

export const ocrRuleSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  severity: z.string(),
  termCount: z.number(),
  terms: z.array(z.string()),
});

export const ocrRulesSchema = z.object({
  version: z.string(),
  minimumWordConfidence: z.number(),
  rules: z.array(ocrRuleSummarySchema),
});

export const rescanResultSchema = z.object({ captureId: simpleAcIdSchema, status: z.string() });

export const overviewSchema = z.object({
  generatedAt: isoTimestampSchema,
  players: z.object({ total: z.number(), seenLast24h: z.number() }),
  detections: z.object({
    last24h: z.number(),
    open: z.number(),
    topRules: z.array(z.object({ ruleKey: z.string(), count: z.number() })),
  }),
  cases: z.object({ open: z.number(), investigating: z.number() }),
  bans: z.object({ active: z.number() }),
  captures: z.object({
    total: z.number(),
    last24h: z.number(),
    ocrMatchesLast24h: z.number(),
  }),
});

export type Detection = z.infer<typeof detectionSchema>;
export type DetectionDetailRecord = z.infer<typeof detectionDetailSchema>;
export type UpdateDetectionRequest = z.infer<typeof updateDetectionRequestSchema>;
export type CaseRecord = z.infer<typeof caseSchema>;
export type CaseDetail = z.infer<typeof caseDetailSchema>;
export type CreateCaseRequest = z.infer<typeof createCaseRequestSchema>;
export type UpdateCaseRequest = z.infer<typeof updateCaseRequestSchema>;
export type ExceptionRecord = z.infer<typeof exceptionSchema>;
export type CreateExceptionRequest = z.infer<typeof createExceptionRequestSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileDetail = z.infer<typeof profileDetailSchema>;
export type OcrRules = z.infer<typeof ocrRulesSchema>;
export type Overview = z.infer<typeof overviewSchema>;
