import { z } from 'zod';
import { simpleAcIdSchema } from './id-schema.js';

export const detectionCategorySchema = z.enum([
  'network',
  'movement',
  'combat',
  'vehicle',
  'integrity',
  'integration',
]);

export const detectionOutcomeSchema = z.enum([
  'log',
  'cancel',
  'warn',
  'restrict',
  'kick',
  'temporary_ban',
  'permanent_ban',
]);

export const detectionSignalSchema = z.object({
  rule: z
    .string()
    .regex(/^[a-z][a-z0-9_.]+$/)
    .max(128),
  source: z.number().int().positive(),
  measured: z.record(z.string(), z.unknown()),
  resourceName: z.string().min(1).max(128).optional(),
});

export const detectionDecisionSchema = z.object({
  accepted: z.boolean(),
  reason: z.string(),
  detectionId: simpleAcIdSchema.optional(),
  severity: z.number().min(0).max(100).optional(),
  confidence: z.number().min(0).max(1).optional(),
  score: z.number().nonnegative().optional(),
  cumulativeRisk: z.number().nonnegative().optional(),
  cancel: z.boolean(),
  outcome: detectionOutcomeSchema.optional(),
});

export type DetectionSignal = z.infer<typeof detectionSignalSchema>;
export type DetectionDecision = z.infer<typeof detectionDecisionSchema>;
