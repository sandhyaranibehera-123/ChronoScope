/**
 * ID Semantics — see docs/architecture/id-semantics.md
 *
 * Strongly typed identifiers to prevent accidental substitution of
 * identifiers with distinct scopes and purposes.
 */

export type TimelineId = string & { readonly __brand: unique symbol };
export type AggregateId = string & { readonly __brand: unique symbol };
export type CommandId = string & { readonly __brand: unique symbol };
export type EventId = string & { readonly __brand: unique symbol };
export type CorrelationId = string & { readonly __brand: unique symbol };
export type CausationId = string & { readonly __brand: unique symbol };
export type RequestId = string & { readonly __brand: unique symbol };
export type ActorId = string & { readonly __brand: unique symbol };
export type ExecutionId = string & { readonly __brand: unique symbol };
export type JobId = string & { readonly __brand: unique symbol };

export function asTimelineId(id: string): TimelineId {
  return id as TimelineId;
}

export function asAggregateId(id: string): AggregateId {
  return id as AggregateId;
}

export function asCommandId(id: string): CommandId {
  return id as CommandId;
}

export function asEventId(id: string): EventId {
  return id as EventId;
}

export function asCorrelationId(id: string): CorrelationId {
  return id as CorrelationId;
}

export function asCausationId(id: string): CausationId {
  return id as CausationId;
}

export function asRequestId(id: string): RequestId {
  return id as RequestId;
}

export function asActorId(id: string): ActorId {
  return id as ActorId;
}

/**
 * Composite aggregate identity: (timeline_id, aggregate_id).
 *
 * A branch can hold the same aggregate_id as MAIN while representing
 * genuinely different state (Phase 7). Every place that keys off
 * "which aggregate" across timelines (including MongoDB projection _id)
 * uses this composite representation: `${timelineId}:${aggregateId}`.
 */
export function formatCompositeAggregateId(timelineId: string, aggregateId: string): string {
  return `${timelineId}:${aggregateId}`;
}

export function parseCompositeAggregateId(compositeId: string): {
  timelineId: string;
  aggregateId: string;
} {
  const index = compositeId.indexOf(':');
  if (index <= 0 || index === compositeId.length - 1) {
    throw new Error(
      `Invalid composite aggregate ID format '${compositeId}'. Expected 'timelineId:aggregateId'`,
    );
  }
  return {
    timelineId: compositeId.slice(0, index),
    aggregateId: compositeId.slice(index + 1),
  };
}
