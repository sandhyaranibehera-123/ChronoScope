import type { Pool, RowDataPacket } from 'mysql2/promise';
import { PreconditionFailedError, type DomainEvent } from '@chronoscope/domain';
import { SQL } from '../sql/statements.js';
import { withTransaction } from '../transaction.js';

export interface TimelineRecord {
  readonly timelineId: string;
  readonly parentTimelineId: string | null;
  readonly forkPosition: number;
  readonly headPosition: number;
  readonly name: string;
  readonly description: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTimelineParams {
  readonly timelineId: string;
  readonly parentTimelineId?: string | null;
  readonly forkPosition?: number;
  readonly name: string;
  readonly description?: string | null;
}

export interface TimelineAncestryNode {
  readonly timelineId: string;
  readonly parentTimelineId: string | null;
  readonly forkPosition: number;
  readonly depth: number;
}

interface TimelineRow extends RowDataPacket {
  timeline_id: string;
  parent_timeline_id: string | null;
  fork_position: number | string;
  head_position: number | string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  created_at: string;
  updated_at: string;
}

interface MaxPosRow extends RowDataPacket {
  max_pos: number | string | null;
}

export class MySqlTimelineRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Creates a timeline with transactional fork position validation (Rules 6 & 13):
   * "fork_position = 0 valid; 0 <= fork_position <= COALESCE(MAX(parent.events.timeline_position), 0),
   * checked transactionally."
   */
  public async createTimeline(params: CreateTimelineParams): Promise<TimelineRecord> {
    const {
      timelineId,
      parentTimelineId = null,
      forkPosition = 0,
      name,
      description = null,
    } = params;

    return withTransaction(this.pool, async (connection) => {
      if (parentTimelineId) {
        // Validate parent exists and fork position is within parent's valid history
        const [parentRows] = await connection.query<TimelineRow[]>(SQL.SELECT_TIMELINE, [
          parentTimelineId,
        ]);

        if (parentRows.length === 0) {
          throw new PreconditionFailedError(`Parent timeline ${parentTimelineId} does not exist`, {
            parentTimelineId,
            timelineId,
          });
        }

        const [maxPosRows] = await connection.query<MaxPosRow[]>(
          SQL.CHECK_PARENT_MAX_TIMELINE_POSITION,
          [parentTimelineId],
        );
        const parentMaxPosition = Number(maxPosRows[0]?.max_pos ?? 0);

        if (forkPosition < 0 || forkPosition > parentMaxPosition) {
          throw new PreconditionFailedError(
            `Invalid fork_position ${forkPosition}: must satisfy 0 <= fork_position <= ${parentMaxPosition} (parent timeline max position)`,
            { forkPosition, parentMaxPosition, parentTimelineId, timelineId },
          );
        }
      } else if (forkPosition !== 0) {
        throw new PreconditionFailedError(
          `Root timeline without parent must have fork_position = 0, got ${forkPosition}`,
          { forkPosition, timelineId },
        );
      }

      await connection.query(SQL.INSERT_TIMELINE, [
        timelineId,
        parentTimelineId,
        forkPosition,
        0, // initial head_position
        name,
        description,
        'ACTIVE',
      ]);

      const [createdRows] = await connection.query<TimelineRow[]>(SQL.SELECT_TIMELINE, [
        timelineId,
      ]);
      const row = createdRows[0]!;

      return {
        timelineId: row.timeline_id,
        parentTimelineId: row.parent_timeline_id,
        forkPosition: Number(row.fork_position),
        headPosition: Number(row.head_position),
        name: row.name,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  public async getTimeline(timelineId: string): Promise<TimelineRecord | null> {
    const [rows] = await this.pool.query<TimelineRow[]>(SQL.SELECT_TIMELINE, [timelineId]);
    const row = rows[0];
    if (!row) return null;

    return {
      timelineId: row.timeline_id,
      parentTimelineId: row.parent_timeline_id,
      forkPosition: Number(row.fork_position),
      headPosition: Number(row.head_position),
      name: row.name,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Retrieves full timeline ancestry hierarchy using a WITH RECURSIVE CTE (Rule 13).
   * Traverses from leaf timeline up to root.
   */
  public async getAncestry(timelineId: string): Promise<TimelineAncestryNode[]> {
    interface AncestryRow extends RowDataPacket {
      timeline_id: string;
      parent_timeline_id: string | null;
      fork_position: number | string;
      depth: number | string;
    }

    const [rows] = await this.pool.query<AncestryRow[]>(SQL.SELECT_TIMELINE_ANCESTRY_RECURSIVE, [
      timelineId,
    ]);

    return rows.map((r) => ({
      timelineId: r.timeline_id,
      parentTimelineId: r.parent_timeline_id,
      forkPosition: Number(r.fork_position),
      depth: Number(r.depth),
    }));
  }

  /**
   * Resolves effective history of events for a timeline using a recursive CTE (Rule 13 & ADR-010):
   * EffectiveHistory(B) = EffectiveHistory(P, <= F) + LocalEvents(B)
   */
  public async getEffectiveEvents(
    timelineId: string,
    aggregateId?: string,
  ): Promise<DomainEvent[]> {
    interface EffectiveEventRow extends RowDataPacket {
      event_id: string;
      timeline_id: string;
      timeline_position: number | string;
      aggregate_id: string;
      aggregate_type: string;
      aggregate_sequence: number | string;
      event_type: string;
      schema_version: number;
      payload: string | Record<string, unknown>;
      event_hash: string;
      causation_id: string | null;
      correlation_id: string;
      command_id: string | null;
      recorded_at: string;
    }

    let rows: EffectiveEventRow[];
    if (aggregateId) {
      const [result] = await this.pool.query<EffectiveEventRow[]>(
        SQL.SELECT_EFFECTIVE_EVENTS_FOR_AGGREGATE_RECURSIVE,
        [timelineId, aggregateId],
      );
      rows = result;
    } else {
      const [result] = await this.pool.query<EffectiveEventRow[]>(
        SQL.SELECT_EFFECTIVE_EVENTS_RECURSIVE,
        [timelineId],
      );
      rows = result;
    }

    return rows.map((r) => {
      let payload = r.payload;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          // keep as string
        }
      }

      return {
        event_id: r.event_id,
        timeline_id: r.timeline_id,
        timeline_position: Number(r.timeline_position),
        aggregate_id: r.aggregate_id,
        aggregate_type: r.aggregate_type,
        aggregate_sequence: Number(r.aggregate_sequence),
        event_type: r.event_type,
        schema_version: r.schema_version,
        payload,
        event_hash: r.event_hash,
        causation_id: r.causation_id,
        correlation_id: r.correlation_id,
        command_id: r.command_id,
        recorded_at: r.recorded_at,
      };
    });
  }
}
