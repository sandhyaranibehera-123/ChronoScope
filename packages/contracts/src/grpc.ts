import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));
export const REPLAY_PROTO_PATH = join(currentDir, 'proto', 'replay.proto');

export const grpcExecuteReplayRequestSchema = z.object({
  timelineId: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string(),
  targetSequence: z.number().int().nonnegative().optional(),
  mode: z.enum(['LIVE_REPLAY', 'COUNTERFACTUAL_REPLAY']).default('LIVE_REPLAY'),
  scenarioSeed: z.string().optional(),
  correlationId: z.string().optional(),
  requestId: z.string().optional(),
  useSnapshot: z.boolean().default(true),
  scenarioInputsJson: z.string().optional(),
});

export type GrpcExecuteReplayRequest = z.infer<typeof grpcExecuteReplayRequestSchema>;

export const grpcExecuteReplayResponseSchema = z.object({
  executionId: z.string(),
  stateHash: z.string(),
  liveStateHash: z.string(),
  hashParityMatched: z.boolean(),
  eventsReplayed: z.number().int().nonnegative(),
  summary: z.string(),
  mode: z.string(),
});

export type GrpcExecuteReplayResponse = z.infer<typeof grpcExecuteReplayResponseSchema>;

export const grpcHealthCheckResponseSchema = z.object({
  status: z.enum(['SERVING', 'NOT_SERVING']),
});

export type GrpcHealthCheckResponse = z.infer<typeof grpcHealthCheckResponseSchema>;
