import { z } from 'zod';

export const workerControlStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'DRAINING']);
export type WorkerControlStatusDto = z.infer<typeof workerControlStatusSchema>;

export const workerControlSchema = z.object({
  controlTarget: z.string().min(1),
  status: workerControlStatusSchema,
  concurrency: z.number().int().min(1),
  config: z.record(z.unknown()).nullable(),
  version: z.number().int().min(1),
  updatedBy: z.string().min(1),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type WorkerControlDto = z.infer<typeof workerControlSchema>;

export const updateWorkerControlRequestSchema = z.object({
  status: workerControlStatusSchema.optional(),
  concurrency: z.number().int().min(1).optional(),
  config: z.record(z.unknown()).nullable().optional(),
  expectedVersion: z.number().int().min(1),
  updatedBy: z.string().min(1).default('operator'),
});
export type UpdateWorkerControlRequest = z.infer<typeof updateWorkerControlRequestSchema>;

export const controlCommandStatusSchema = z.enum([
  'PENDING',
  'EXECUTING',
  'COMPLETED',
  'CANCELLATION_REQUESTED',
  'CANCELLED',
  'FAILED',
]);
export type ControlCommandStatusDto = z.infer<typeof controlCommandStatusSchema>;

export const controlCommandSchema = z.object({
  commandId: z.string().uuid(),
  commandType: z.string().min(1),
  targetWorker: z.string().min(1),
  payload: z.record(z.unknown()),
  status: controlCommandStatusSchema,
  issuedBy: z.string().min(1),
  resultPayload: z.record(z.unknown()).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  attemptCount: z.number().int().nonnegative(),
  acknowledgedBy: z.string().nullable().optional(),
  acknowledgedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ControlCommandDto = z.infer<typeof controlCommandSchema>;

export const createControlCommandRequestSchema = z.object({
  commandId: z.string().uuid().optional(),
  commandType: z.string().min(1),
  targetWorker: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  issuedBy: z.string().min(1).default('operator'),
});
export type CreateControlCommandRequest = z.infer<typeof createControlCommandRequestSchema>;

export const cancelControlCommandRequestSchema = z.object({
  reason: z.string().optional(),
});
export type CancelControlCommandRequest = z.infer<typeof cancelControlCommandRequestSchema>;

export const controlCommandListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ControlCommandListQuery = z.infer<typeof controlCommandListQuerySchema>;
