import type { AggregateId, CausationId, CorrelationId, EventId, TimelineId } from './id.js';

/**
 * Domain Event interface — system-guarantees.md rules 3, 4, 11:
 * - Immutable
 * - Carries schema_version (Rule 4)
 * - Carries event_hash computed over canonical payload (Rule 11)
 * - Identifies causation and correlation chains
 */
export interface DomainEvent<TPayload = unknown> {
  readonly event_id: EventId | string;
  readonly timeline_id: TimelineId | string;
  readonly aggregate_id: AggregateId | string;
  readonly aggregate_type: string;
  readonly aggregate_sequence: number;
  readonly event_type: string;
  readonly schema_version: number;
  readonly payload: TPayload;
  readonly event_hash: string;
  readonly causation_id: CausationId | string | null;
  readonly correlation_id: CorrelationId | string;
  readonly recorded_at: string; // ISO 8601 UTC timestamp
  readonly timeline_position?: number | undefined;
  readonly command_id?: string | null | undefined;
}

/**
 * Version axes — system-guarantees.md rule 4:
 * "application_version, event_schema_version, and domain_logic_version
 * are tracked as three separate axes."
 */
export interface VersionAxes {
  readonly application_version: string;
  readonly event_schema_version: number;
  readonly domain_logic_version: number;
}

export interface StoredEventRecord {
  readonly event_id: string;
  readonly timeline_id: string;
  readonly timeline_position: number;
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly aggregate_sequence: number;
  readonly event_type: string;
  readonly schema_version: number;
  readonly payload: string; // JSON string
  readonly event_hash: string;
  readonly causation_id: string | null;
  readonly correlation_id: string;
  readonly recorded_at: string;
}

export type EventUpcaster<TOld = unknown, TNew = unknown> = (
  oldPayload: TOld,
  schemaVersion: number,
) => TNew;
