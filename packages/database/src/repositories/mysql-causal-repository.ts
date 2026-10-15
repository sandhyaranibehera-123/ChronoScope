import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';

export interface StoredEventRow extends RowDataPacket {
  event_id: string;
  timeline_id: string;
  timeline_position: number | string;
  aggregate_id: string;
  aggregate_type: string;
  aggregate_sequence: number | string;
  event_type: string;
  schema_version: number | string;
  payload: string | Record<string, unknown>;
  event_hash: string;
  causation_id: string | null;
  correlation_id: string;
  command_id: string | null;
  recorded_at: string;
  depth?: number | string;
}

export interface CausalEventRecord {
  readonly eventId: string;
  readonly timelineId: string;
  readonly timelinePosition: number;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateSequence: number;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
  readonly eventHash: string;
  readonly causationId: string | null;
  readonly correlationId: string;
  readonly commandId: string | null;
  readonly recordedAt: string;
  readonly depth?: number | undefined;
}

function mapRowToRecord(row: StoredEventRow): CausalEventRecord {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

  return {
    eventId: row.event_id,
    timelineId: row.timeline_id,
    timelinePosition: Number(row.timeline_position),
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    aggregateSequence: Number(row.aggregate_sequence),
    eventType: row.event_type,
    schemaVersion: Number(row.schema_version),
    payload,
    eventHash: row.event_hash,
    causationId: row.causation_id,
    correlationId: row.correlation_id,
    commandId: row.command_id,
    recordedAt: String(row.recorded_at),
    depth: row.depth !== undefined ? Number(row.depth) : undefined,
  };
}

export class MySqlCausalRepository {
  constructor(private readonly pool: Pool) {}

  public async getEventById(eventId: string): Promise<CausalEventRecord | null> {
    const [rows] = await this.pool.query<StoredEventRow[]>(SQL.SELECT_EVENT_BY_ID, [eventId]);
    const first = rows[0];
    if (!first) return null;
    return mapRowToRecord(first);
  }

  public async getEventsByCorrelationId(
    correlationId: string,
  ): Promise<readonly CausalEventRecord[]> {
    const [rows] = await this.pool.query<StoredEventRow[]>(SQL.SELECT_EVENTS_BY_CORRELATION_ID, [
      correlationId,
    ]);
    return rows.map(mapRowToRecord);
  }

  public async getEventsByCausationId(causationId: string): Promise<readonly CausalEventRecord[]> {
    const [rows] = await this.pool.query<StoredEventRow[]>(SQL.SELECT_EVENTS_BY_CAUSATION_ID, [
      causationId,
    ]);
    return rows.map(mapRowToRecord);
  }

  public async getEventsByTimelineId(timelineId: string): Promise<readonly CausalEventRecord[]> {
    const [rows] = await this.pool.query<StoredEventRow[]>(SQL.SELECT_EVENTS_BY_TIMELINE, [
      timelineId,
    ]);
    return rows.map(mapRowToRecord);
  }

  public async getCausalAncestors(eventId: string): Promise<readonly CausalEventRecord[]> {
    const [rows] = await this.pool.query<StoredEventRow[]>(SQL.SELECT_CAUSAL_ANCESTORS_RECURSIVE, [
      eventId,
    ]);
    return rows.map(mapRowToRecord);
  }

  public async getCausalDescendants(eventId: string): Promise<readonly CausalEventRecord[]> {
    const [rows] = await this.pool.query<StoredEventRow[]>(
      SQL.SELECT_CAUSAL_DESCENDANTS_RECURSIVE,
      [eventId],
    );
    return rows.map(mapRowToRecord);
  }
}
