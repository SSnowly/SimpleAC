import { z } from 'zod';

export const healthStatusSchema = z.enum(['booting', 'ready', 'degraded']);
export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  resource: z.string().min(1),
  version: z.string().min(1),
  migrationVersion: z.number().int().nonnegative().nullable(),
  uptimeSeconds: z.number().nonnegative(),
  dependencies: z.object({ oxLib: z.string(), oxmysql: z.string() }),
  failure: z.string().nullable(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
