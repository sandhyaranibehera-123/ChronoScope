import { z } from 'zod';

export const experimentCategorySchema = z.enum([
  'CHAOS',
  'CONCURRENCY',
  'CONSISTENCY',
  'RECOVERY',
  'REPLAY',
]);
export type ExperimentCategory = z.infer<typeof experimentCategorySchema>;

export const experimentRunStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
]);
export type ExperimentRunStatus = z.infer<typeof experimentRunStatusSchema>;

export const experimentInvariantStatusSchema = z.enum(['PASSED', 'FAILED', 'SKIPPED']);
export type ExperimentInvariantStatus = z.infer<typeof experimentInvariantStatusSchema>;

/**
 * Machine profile pinned to exact patch versions and image digests (Rule 22).
 */
export const machineProfileSchema = z.object({
  mysqlVersion: z.string().min(1),
  mongodbVersion: z.string().min(1),
  mysqlImageDigest: z.string().min(1),
  mongodbImageDigest: z.string().min(1),
  nodeVersion: z.string().min(1),
  dockerVersion: z.string().min(1),
  osArch: z.string().min(1),
});
export type MachineProfile = z.infer<typeof machineProfileSchema>;

/**
 * Complete reproducibility manifest schema (Rule 22).
 */
export const experimentManifestSchema = z.object({
  gitSha: z.string().min(7),
  schemaVersion: z.number().int().positive(),
  domainLogicVersion: z.number().int().positive(),
  appVersion: z.string().min(1),
  datasetVersion: z.string().min(1),
  configHash: z.string().length(64),
  scenarioSeed: z.string().min(1),
  machineProfile: machineProfileSchema,
  workload: z.record(z.unknown()).optional(),
  warmUp: z.record(z.unknown()).optional(),
});
export type ExperimentManifest = z.infer<typeof experimentManifestSchema>;

export const createExperimentRequestSchema = z.object({
  experimentId: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  category: experimentCategorySchema,
  description: z.string().min(1),
  hypothesis: z.string().min(1),
  steadyStateInvariants: z.record(z.unknown()),
  faultConfig: z.record(z.unknown()).optional(),
});
export type CreateExperimentRequest = z.infer<typeof createExperimentRequestSchema>;

export const runExperimentRequestSchema = z.object({
  runId: z.string().uuid().optional(),
  scenarioSeed: z.string().optional(),
  workload: z.record(z.unknown()).optional(),
  warmUp: z.record(z.unknown()).optional(),
});
export type RunExperimentRequest = z.infer<typeof runExperimentRequestSchema>;

export const experimentInvariantSchema = z.object({
  invariantId: z.string().uuid(),
  runId: z.string().uuid(),
  invariantName: z.string().min(1),
  status: experimentInvariantStatusSchema,
  expectedValue: z.unknown(),
  measuredValue: z.unknown(),
  details: z.string().optional(),
  evaluatedAt: z.string().datetime().optional(),
});
export type ExperimentInvariant = z.infer<typeof experimentInvariantSchema>;

export const experimentRunResponseSchema = z.object({
  runId: z.string().uuid(),
  experimentId: z.string().min(1),
  status: experimentRunStatusSchema,
  manifest: experimentManifestSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  invariantsPassed: z.boolean(),
  resultSummary: z.record(z.unknown()).optional(),
  errorMessage: z.string().optional(),
  invariants: z.array(experimentInvariantSchema).optional(),
});
export type ExperimentRunResponse = z.infer<typeof experimentRunResponseSchema>;
