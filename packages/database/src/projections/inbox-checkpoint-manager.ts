import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';
import { withTransaction } from '../transaction.js';

export interface InboxCheckpointRecord {
  readonly eventId: string;
  readonly consumerName: string;
  readonly projectionName: string;
  readonly topic: string;
  readonly kafkaPartition: number;
  readonly kafkaOffset: number;
}

export interface CheckpointInfo {
  readonly projectionName: string;
  readonly topic: string;
  readonly kafkaPartition: number;
  readonly kafkaOffset: number;
  readonly lastEventId: string | null;
}

export interface ProjectionStatusInfo {
  readonly status: 'ACTIVE' | 'REBUILDING' | 'VALIDATING' | 'SWAPPING' | 'FAILED';
  readonly projectionVersion: number;
  readonly schemaVersion: number;
}

export interface IInboxCheckpointManager {
  recordInboxAndCheckpoint(record: InboxCheckpointRecord): Promise<{ isDuplicate: boolean }>;
  isEventInInbox(eventId: string, consumerName: string): Promise<boolean>;
  getCheckpoint(
    projectionName: string,
    topic: string,
    partition: number,
  ): Promise<CheckpointInfo | null>;
  getProjectionStatus(projectionName: string): Promise<ProjectionStatusInfo | null>;
  acquireAdvisoryLock(lockName: string, timeoutSeconds?: number): Promise<boolean>;
  releaseAdvisoryLock(lockName: string): Promise<boolean>;
}

/**
 * MySQL implementation of the Rule 10 step (b) coordinator:
 * Commits inbox deduplication row and updates projection_checkpoints in a single transaction.
 */
export class MysqlInboxCheckpointManager implements IInboxCheckpointManager {
  constructor(private readonly pool: Pool) {}

  public async recordInboxAndCheckpoint(
    record: InboxCheckpointRecord,
  ): Promise<{ isDuplicate: boolean }> {
    return withTransaction(this.pool, async (connection: PoolConnection) => {
      // 1. Dedup inbox insert (INSERT IGNORE)
      const [inboxResult] = await connection.query<ResultSetHeader>(SQL.INSERT_IGNORE_INBOX, [
        record.eventId,
        record.consumerName,
      ]);

      const isDuplicate = inboxResult.affectedRows === 0;

      // 2. Advance projection checkpoint (stores LAST-PROCESSED offset, Rule 10)
      await connection.query(SQL.UPSERT_PROJECTION_CHECKPOINT, [
        record.projectionName,
        record.topic,
        record.kafkaPartition,
        record.kafkaOffset,
        record.eventId,
      ]);

      return { isDuplicate };
    });
  }

  public async isEventInInbox(eventId: string, consumerName: string): Promise<boolean> {
    const [rows] = await connectionQuery<RowDataPacket[]>(this.pool, SQL.CHECK_INBOX_EXISTS, [
      eventId,
      consumerName,
    ]);
    return rows.length > 0;
  }

  public async getCheckpoint(
    projectionName: string,
    topic: string,
    partition: number,
  ): Promise<CheckpointInfo | null> {
    const [rows] = await connectionQuery<RowDataPacket[]>(
      this.pool,
      SQL.SELECT_PROJECTION_CHECKPOINT,
      [projectionName, topic, partition],
    );
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      projectionName: String(row['projection_name']),
      topic: String(row['topic']),
      kafkaPartition: Number(row['kafka_partition']),
      kafkaOffset: Number(row['kafka_offset']),
      lastEventId: row['last_event_id'] ? String(row['last_event_id']) : null,
    };
  }

  public async getProjectionStatus(projectionName: string): Promise<ProjectionStatusInfo | null> {
    const [rows] = await connectionQuery<RowDataPacket[]>(this.pool, SQL.SELECT_PROJECTION_STATUS, [
      projectionName,
    ]);
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      status: row['status'] as ProjectionStatusInfo['status'],
      projectionVersion: Number(row['projection_version']),
      schemaVersion: Number(row['schema_version']),
    };
  }

  public async acquireAdvisoryLock(lockName: string, timeoutSeconds: number = 5): Promise<boolean> {
    const [rows] = await connectionQuery<RowDataPacket[]>(this.pool, SQL.GET_ADVISORY_LOCK, [
      lockName,
      timeoutSeconds,
    ]);
    return rows[0]?.['acquired'] === 1;
  }

  public async releaseAdvisoryLock(lockName: string): Promise<boolean> {
    const [rows] = await connectionQuery<RowDataPacket[]>(this.pool, SQL.RELEASE_ADVISORY_LOCK, [
      lockName,
    ]);
    return rows[0]?.['released'] === 1;
  }
}

async function connectionQuery<T>(
  pool: Pool,
  sql: string,
  values?: unknown[],
): Promise<[T, unknown]> {
  const result = await pool.query(sql, values);
  return [result[0] as T, result[1]];
}

/**
 * In-memory implementation of IInboxCheckpointManager for 100% infra-free testing (Rule 24).
 */
export class InMemoryInboxCheckpointManager implements IInboxCheckpointManager {
  private readonly inbox = new Set<string>(); // `${eventId}:${consumerName}`
  private readonly checkpoints = new Map<string, CheckpointInfo>(); // `${projectionName}:${topic}:${partition}`
  private readonly statuses = new Map<string, ProjectionStatusInfo>();
  private readonly heldLocks = new Set<string>();

  constructor() {
    // Default active projections
    this.statuses.set('order_summary', {
      status: 'ACTIVE',
      projectionVersion: 1,
      schemaVersion: 1,
    });
    this.statuses.set('payment_summary', {
      status: 'ACTIVE',
      projectionVersion: 1,
      schemaVersion: 1,
    });
    this.statuses.set('shipment_summary', {
      status: 'ACTIVE',
      projectionVersion: 1,
      schemaVersion: 1,
    });
  }

  public async recordInboxAndCheckpoint(
    record: InboxCheckpointRecord,
  ): Promise<{ isDuplicate: boolean }> {
    const key = `${record.eventId}:${record.consumerName}`;
    const isDuplicate = this.inbox.has(key);
    this.inbox.add(key);

    const checkpointKey = `${record.projectionName}:${record.topic}:${record.kafkaPartition}`;
    const existing = this.checkpoints.get(checkpointKey);
    const newOffset = existing
      ? Math.max(existing.kafkaOffset, record.kafkaOffset)
      : record.kafkaOffset;

    this.checkpoints.set(checkpointKey, {
      projectionName: record.projectionName,
      topic: record.topic,
      kafkaPartition: record.kafkaPartition,
      kafkaOffset: newOffset,
      lastEventId: record.eventId,
    });

    return { isDuplicate };
  }

  public async isEventInInbox(eventId: string, consumerName: string): Promise<boolean> {
    return this.inbox.has(`${eventId}:${consumerName}`);
  }

  public async getCheckpoint(
    projectionName: string,
    topic: string,
    partition: number,
  ): Promise<CheckpointInfo | null> {
    return this.checkpoints.get(`${projectionName}:${topic}:${partition}`) ?? null;
  }

  public async getProjectionStatus(projectionName: string): Promise<ProjectionStatusInfo | null> {
    return this.statuses.get(projectionName) ?? null;
  }

  public setProjectionStatus(projectionName: string, status: ProjectionStatusInfo['status']): void {
    const current = this.statuses.get(projectionName) ?? {
      projectionVersion: 1,
      schemaVersion: 1,
      status: 'ACTIVE',
    };
    this.statuses.set(projectionName, { ...current, status });
  }

  public async acquireAdvisoryLock(lockName: string): Promise<boolean> {
    if (this.heldLocks.has(lockName)) {
      return false;
    }
    this.heldLocks.add(lockName);
    return true;
  }

  public async releaseAdvisoryLock(lockName: string): Promise<boolean> {
    return this.heldLocks.delete(lockName);
  }

  public clear(): void {
    this.inbox.clear();
    this.checkpoints.clear();
    this.heldLocks.clear();
  }
}
