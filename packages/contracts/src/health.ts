import { z } from 'zod';

/** GET /health/live — process is up, no dependency checks. */
export const liveResponseSchema = z.object({
  status: z.literal('live'),
});
export type LiveResponse = z.infer<typeof liveResponseSchema>;

/** GET /health/version — build metadata. */
export const versionResponseSchema = z.object({
  version: z.string(),
  gitSha: z.string(),
  nodeVersion: z.string(),
});
export type VersionResponse = z.infer<typeof versionResponseSchema>;

const dependencyCheckSchema = z.object({
  status: z.enum(['ok', 'fail']),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

/**
 * GET /health/ready/write — MySQL + Redis only.
 * Deliberately NOT one global /health/ready: a MongoDB outage (Phase 4+)
 * must never read as identical to a MySQL outage — they're different
 * failure domains with different blast radii (plan rule: component-specific
 * readiness). This is the write-path endpoint; /health/ready/read (Mongo)
 * arrives in Phase 4.
 */
export const readyWriteResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    mysql: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
});
export type ReadyWriteResponse = z.infer<typeof readyWriteResponseSchema>;

/**
 * GET /health/ready/read — MongoDB only (Phase 4).
 * Probes read-side query model and projection store readiness.
 */
export const readyReadResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    mongo: dependencyCheckSchema,
  }),
});
export type ReadyReadResponse = z.infer<typeof readyReadResponseSchema>;
