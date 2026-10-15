import { z } from 'zod';

export const forkTimelineRequestSchema = z.object({
  parentTimelineId: z.string().min(1),
  forkPosition: z.number().int().nonnegative().optional().default(0),
  name: z.string().min(1).max(64),
  description: z.string().max(255).optional().nullable(),
});
export type ForkTimelineRequest = z.infer<typeof forkTimelineRequestSchema>;

export const timelineRecordResponseSchema = z.object({
  timelineId: z.string(),
  parentTimelineId: z.string().nullable(),
  forkPosition: z.number(),
  headPosition: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type TimelineRecordResponse = z.infer<typeof timelineRecordResponseSchema>;

export const createScenarioInputRequestSchema = z.object({
  inputType: z.string().min(1).max(64),
  aggregateId: z.string().optional().nullable(),
  parameters: z.record(z.unknown()).optional().nullable(),
});
export type CreateScenarioInputRequest = z.infer<typeof createScenarioInputRequestSchema>;

export const scenarioInputResponseSchema = z.object({
  inputId: z.string(),
  timelineId: z.string(),
  aggregateId: z.string().nullable(),
  inputType: z.string(),
  parameters: z.record(z.unknown()).nullable(),
  applied: z.boolean(),
  createdAt: z.string(),
});
export type ScenarioInputResponse = z.infer<typeof scenarioInputResponseSchema>;

export const counterfactualReplayRequestSchema = z.object({
  timelineId: z.string().min(1),
  aggregateId: z.string().min(1),
  aggregateType: z.string().optional().default('Order'),
  scenarioSeed: z.union([z.string(), z.number()]).optional().default('counterfactual-seed'),
});
export type CounterfactualReplayRequest = z.infer<typeof counterfactualReplayRequestSchema>;

export const counterfactualReplayResponseSchema = z.object({
  executionId: z.string(),
  mode: z.literal('COUNTERFACTUAL_REPLAY'),
  timelineId: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string(),
  eventsReplayed: z.number(),
  stateHash: z.string(),
  liveStateHash: z.string(),
  hashParityMatched: z.boolean(),
  state: z.unknown().nullable(),
  durationMs: z.number(),
});
export type CounterfactualReplayResponse = z.infer<typeof counterfactualReplayResponseSchema>;

export const diffTimelinesQuerySchema = z.object({
  timelineIdA: z.string().min(1),
  timelineIdB: z.string().min(1),
  aggregateId: z.string().optional(),
});
export type DiffTimelinesQuery = z.infer<typeof diffTimelinesQuerySchema>;

export const timelineDiffResponseSchema = z.object({
  timelineIdA: z.string(),
  timelineIdB: z.string(),
  commonAncestorTimelineId: z.string().nullable(),
  forkPosition: z.number(),
  aggregateId: z.string().nullable(),
  stateHashA: z.string().nullable(),
  stateHashB: z.string().nullable(),
  hashesMatch: z.boolean(),
  stateA: z.unknown().nullable(),
  stateB: z.unknown().nullable(),
  stateDiff: z.object({
    status: z.object({ from: z.unknown(), to: z.unknown() }).optional(),
    fieldsChanged: z.record(z.object({ from: z.unknown(), to: z.unknown() })).optional(),
    divergenceReason: z.string().optional(),
  }),
  divergingEventsA: z.array(z.unknown()),
  divergingEventsB: z.array(z.unknown()),
  scenarioInputs: z.array(scenarioInputResponseSchema),
});
export type TimelineDiffResponse = z.infer<typeof timelineDiffResponseSchema>;
