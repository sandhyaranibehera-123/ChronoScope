import type { DomainEvent } from '@chronoscope/domain';
import type { TimelineAncestryNode } from '../timeline/ancestry.js';

export type CausalEdgeType = 'CAUSATION' | 'TIMELINE_ANCESTRY' | 'WORKFLOW';

export interface CausalGraphNode {
  readonly id: string;
  readonly timelineId: string;
  readonly timelinePosition: number;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateSequence: number;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly eventHash: string;
  readonly causationId: string | null;
  readonly correlationId: string;
  readonly commandId?: string | null | undefined;
  readonly recordedAt: string;
  readonly payloadSummary?: string | undefined;
}

export interface CausationEdge {
  readonly type: 'CAUSATION';
  readonly source: string; // causationId (parent eventId)
  readonly target: string; // eventId (child eventId)
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface TimelineAncestryEdge {
  readonly type: 'TIMELINE_ANCESTRY';
  readonly source: string; // parent timeline event at fork boundary
  readonly target: string; // branch timeline's first local event
  readonly metadata?:
    | {
        readonly parentTimelineId: string;
        readonly branchTimelineId: string;
        readonly forkPosition: number;
      }
    | undefined;
}

export interface WorkflowEdge {
  readonly type: 'WORKFLOW';
  readonly source: string; // preceding event in saga workflow
  readonly target: string; // subsequent event in saga workflow
  readonly metadata?:
    | {
        readonly correlationId: string;
        readonly stepOrder: number;
      }
    | undefined;
}

export type CausalGraphEdge = CausationEdge | TimelineAncestryEdge | WorkflowEdge;

export interface CausalGraphMetrics {
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly causationEdges: number;
  readonly timelineAncestryEdges: number;
  readonly workflowEdges: number;
  readonly maxDepth: number;
  readonly branchingFactor: number;
  readonly aggregateCount: number;
  readonly timelineCount: number;
}

export interface CausalCycleReport {
  readonly path: readonly string[];
}

export interface CausalGraph {
  readonly rootEventIds: readonly string[];
  readonly nodes: Record<string, CausalGraphNode>;
  readonly edges: readonly CausalGraphEdge[];
  readonly cycleDetected: boolean;
  readonly cycles?: readonly CausalCycleReport[] | undefined;
  readonly metrics: CausalGraphMetrics;
}

export interface CausalChainStep {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly timelineId: string;
}

export interface RootCauseExplanation {
  readonly targetEventId: string;
  readonly targetEventType: string;
  readonly rootEventId: string;
  readonly rootEventType: string;
  readonly causalChain: readonly CausalChainStep[];
  readonly immediateCause: {
    readonly eventId: string;
    readonly eventType: string;
  } | null;
  readonly narrative: string;
}

export interface TraversalOptions {
  readonly direction?: 'upstream' | 'downstream' | 'both' | undefined;
  readonly maxDepth?: number | undefined;
  readonly includeWorkflowEdges?: boolean | undefined;
  readonly includeAncestryEdges?: boolean | undefined;
}

export interface CausalEventProvider {
  getEventById(eventId: string): Promise<DomainEvent | null> | (DomainEvent | null);
  getEventsByCorrelationId(
    correlationId: string,
  ): Promise<readonly DomainEvent[]> | readonly DomainEvent[];
  getEventsByTimelineId?(
    timelineId: string,
  ): Promise<readonly DomainEvent[]> | readonly DomainEvent[];
  getEventsByCausationId?(
    causationId: string,
  ): Promise<readonly DomainEvent[]> | readonly DomainEvent[];
  getAncestry?(
    timelineId: string,
  ): Promise<readonly TimelineAncestryNode[]> | readonly TimelineAncestryNode[];
  getAllEvents?(): Promise<readonly DomainEvent[]> | readonly DomainEvent[];
}
