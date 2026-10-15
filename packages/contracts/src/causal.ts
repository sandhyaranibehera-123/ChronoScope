import { z } from 'zod';

export const causalEdgeTypeSchema = z.enum(['CAUSATION', 'TIMELINE_ANCESTRY', 'WORKFLOW']);
export type CausalEdgeType = z.infer<typeof causalEdgeTypeSchema>;

export const causalGraphNodeSchema = z.object({
  id: z.string(),
  timelineId: z.string(),
  timelinePosition: z.number(),
  aggregateId: z.string(),
  aggregateType: z.string(),
  aggregateSequence: z.number(),
  eventType: z.string(),
  schemaVersion: z.number(),
  eventHash: z.string(),
  causationId: z.string().nullable(),
  correlationId: z.string(),
  commandId: z.string().nullable().optional(),
  recordedAt: z.string(),
  payloadSummary: z.string().optional(),
});
export type CausalGraphNodeContract = z.infer<typeof causalGraphNodeSchema>;

export const causalGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: causalEdgeTypeSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CausalGraphEdgeContract = z.infer<typeof causalGraphEdgeSchema>;

export const causalGraphMetricsSchema = z.object({
  totalNodes: z.number(),
  totalEdges: z.number(),
  causationEdges: z.number(),
  timelineAncestryEdges: z.number(),
  workflowEdges: z.number(),
  maxDepth: z.number(),
  branchingFactor: z.number(),
  aggregateCount: z.number(),
  timelineCount: z.number(),
});
export type CausalGraphMetricsContract = z.infer<typeof causalGraphMetricsSchema>;

export const causalGraphResponseSchema = z.object({
  rootEventIds: z.array(z.string()),
  nodes: z.record(z.string(), causalGraphNodeSchema),
  edges: z.array(causalGraphEdgeSchema),
  cycleDetected: z.boolean(),
  cycles: z.array(z.object({ path: z.array(z.string()) })).optional(),
  metrics: causalGraphMetricsSchema,
});
export type CausalGraphResponseContract = z.infer<typeof causalGraphResponseSchema>;

export const causalChainStepSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  timelineId: z.string(),
});
export type CausalChainStepContract = z.infer<typeof causalChainStepSchema>;

export const rootCauseExplanationResponseSchema = z.object({
  targetEventId: z.string(),
  targetEventType: z.string(),
  rootEventId: z.string(),
  rootEventType: z.string(),
  causalChain: z.array(causalChainStepSchema),
  immediateCause: z
    .object({
      eventId: z.string(),
      eventType: z.string(),
    })
    .nullable(),
  narrative: z.string(),
});
export type RootCauseExplanationResponseContract = z.infer<
  typeof rootCauseExplanationResponseSchema
>;

export const causalEventQuerySchema = z.object({
  direction: z.enum(['upstream', 'downstream', 'both']).default('both'),
  maxDepth: z.coerce.number().int().min(1).max(50).default(20),
  format: z.enum(['json', 'ascii', 'dot', 'mermaid']).default('json'),
});
export type CausalEventQuery = z.infer<typeof causalEventQuerySchema>;

export const causalWorkflowQuerySchema = z.object({
  format: z.enum(['json', 'ascii', 'dot', 'mermaid']).default('json'),
});
export type CausalWorkflowQuery = z.infer<typeof causalWorkflowQuerySchema>;
