import { randomUUID } from 'node:crypto';
import type {
  AggregateId,
  CausationId,
  CorrelationId,
  DomainEvent,
  EventId,
  TimelineId,
} from '@chronoscope/domain';
import { computeEventHash } from '@chronoscope/domain';
import { getEventDefinition } from './catalog.js';

export interface CreateEventParams<TPayload> {
  readonly eventId?: EventId | string;
  readonly timelineId: TimelineId | string;
  readonly aggregateId: AggregateId | string;
  readonly aggregateType: string;
  readonly aggregateSequence: number;
  readonly eventType: string;
  readonly schemaVersion?: number;
  readonly payload: TPayload;
  readonly causationId?: CausationId | string | null;
  readonly correlationId: CorrelationId | string;
  readonly recordedAt?: string;
}

/**
 * Creates a valid, immutable DomainEvent envelope with canonical SHA-256 event_hash (Rules 3, 4, 11).
 */
export function createDomainEvent<TPayload = unknown>(
  params: CreateEventParams<TPayload>,
): DomainEvent<TPayload> {
  const definition = getEventDefinition(params.eventType);
  const schemaVersion = params.schemaVersion ?? definition?.currentSchemaVersion ?? 1;
  const eventHash = computeEventHash(params.payload);
  const recordedAt = params.recordedAt ?? new Date().toISOString();

  return Object.freeze({
    event_id: params.eventId ?? randomUUID(),
    timeline_id: params.timelineId,
    aggregate_id: params.aggregateId,
    aggregate_type: params.aggregateType,
    aggregate_sequence: params.aggregateSequence,
    event_type: params.eventType,
    schema_version: schemaVersion,
    payload: params.payload,
    event_hash: eventHash,
    causation_id: params.causationId ?? null,
    correlation_id: params.correlationId,
    recorded_at: recordedAt,
  });
}

/**
 * Validates that an event envelope satisfies the system guarantees:
 * - immutable structure
 * - non-empty IDs
 * - sequence >= 1
 * - canonical 64-char event_hash matching payload
 */
export function validateDomainEvent(event: DomainEvent): void {
  if (!event.event_id || typeof event.event_id !== 'string') {
    throw new Error('Event must have a valid string event_id');
  }
  if (!event.timeline_id || typeof event.timeline_id !== 'string') {
    throw new Error('Event must have a valid string timeline_id');
  }
  if (!event.aggregate_id || typeof event.aggregate_id !== 'string') {
    throw new Error('Event must have a valid string aggregate_id');
  }
  if (typeof event.aggregate_sequence !== 'number' || event.aggregate_sequence < 1) {
    throw new Error(
      `Event aggregate_sequence must be a positive integer >= 1, got ${event.aggregate_sequence}`,
    );
  }
  if (!event.event_hash || event.event_hash.length !== 64) {
    throw new Error(`Event must have a 64-character event_hash, got ${event.event_hash}`);
  }

  const expectedHash = computeEventHash(event.payload);
  if (event.event_hash !== expectedHash) {
    throw new Error(
      `Event hash mismatch for event ${event.event_id}: expected ${expectedHash}, got ${event.event_hash}`,
    );
  }
}
