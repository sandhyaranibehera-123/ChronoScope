import { z } from 'zod';

export const replayLiveRequestSchema = z.object({
  timelineId: z.string().uuid(),
  aggregateId: z.string().min(1),
  aggregateType: z.string().default('Order'),
  targetSequence: z.number().int().nonnegative().optional(),
  useSnapshot: z.boolean().default(true),
  scenarioSeed: z.union([z.string(), z.number()]).optional(),
});

export type ReplayLiveRequest = z.infer<typeof replayLiveRequestSchema>;

export const replayLiveResponseSchema = z.object({
  executionId: z.string().uuid(),
  timelineId: z.string().uuid(),
  aggregateId: z.string(),
  aggregateType: z.string(),
  fromSequence: z.number().int().nonnegative(),
  toSequence: z.number().int().nonnegative(),
  snapshotId: z.string().nullable(),
  eventsReplayed: z.number().int().nonnegative(),
  stateHash: z.string().length(64),
  liveStateHash: z.string().length(64),
  hashParityMatched: z.boolean(),
  durationMs: z.number().nonnegative(),
});

export type ReplayLiveResponse = z.infer<typeof replayLiveResponseSchema>;

export const createAggregateSnapshotRequestSchema = z.object({
  timelineId: z.string().uuid(),
  aggregateId: z.string().min(1),
  targetSequence: z.number().int().positive(),
  aggregateType: z.string().default('Order'),
});

export type CreateAggregateSnapshotRequest = z.infer<typeof createAggregateSnapshotRequestSchema>;

export const createAggregateSnapshotResponseSchema = z.object({
  snapshotId: z.string().uuid(),
  timelineId: z.string().uuid(),
  aggregateId: z.string(),
  aggregateType: z.string(),
  aggregateSequence: z.number().int().positive(),
  stateHash: z.string().length(64),
  contentHash: z.string().length(64),
  status: z.enum(['CREATING', 'READY', 'FAILED']),
});

export type CreateAggregateSnapshotResponse = z.infer<typeof createAggregateSnapshotResponseSchema>;

export const executionRecordResponseSchema = z.object({
  executionId: z.string().uuid(),
  mode: z.enum(['LIVE_REPLAY', 'COUNTERFACTUAL_REPLAY']),
  timelineId: z.string().uuid(),
  aggregateId: z.string().nullable(),
  fromSequence: z.number().int().nonnegative(),
  toSequence: z.number().int().nonnegative().nullable(),
  snapshotId: z.string().nullable(),
  eventsReplayed: z.number().int().nonnegative(),
  stateHash: z.string().length(64).nullable(),
  liveStateHash: z.string().length(64).nullable(),
  hashParityMatched: z.boolean().nullable(),
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']),
  summary: z.record(z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export type ExecutionRecordResponse = z.infer<typeof executionRecordResponseSchema>;
