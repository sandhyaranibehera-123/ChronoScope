import { z } from 'zod';

export const jobTypeSchema = z.enum([
  'SNAPSHOT_GENERATION',
  'PROJECTION_REBUILD',
  'EXPORT',
  'BENCHMARK',
]);

export type JobType = z.infer<typeof jobTypeSchema>;

export const jobStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'RETRY_PENDING',
  'FAILED',
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;

export const createJobRequestSchema = z.object({
  jobType: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  maxAttempts: z.number().int().positive().optional(),
  queueName: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
});

export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const jobResponseSchema = z.object({
  jobId: z.string(),
  jobType: z.string(),
  idempotencyKey: z.string(),
  status: jobStatusSchema,
  payload: z.unknown(),
  resultReference: z.string().nullable(),
  errorMessage: z.string().nullable(),
  attemptCount: z.number().int(),
  maxAttempts: z.number().int(),
  scheduledAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type JobResponse = z.infer<typeof jobResponseSchema>;

export const jobListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().default(50),
});

export type JobListQuery = z.infer<typeof jobListQuerySchema>;
