import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';
import { withTransaction } from '../transaction.js';

export interface LeasedOutboxMessage {
  readonly outboxId: string;
  readonly eventId: string;
  readonly topic: string;
  readonly partitionKey: string;
  readonly payload: unknown;
  readonly attemptCount: number;
  readonly maxAttempts: number;
}

export interface LeaseOptions {
  readonly workerId: string;
  readonly batchSize?: number;
  readonly leaseDurationSeconds?: number;
}

interface OutboxRow extends RowDataPacket {
  outbox_id: string;
  event_id: string;
  topic: string;
  partition_key: string;
  payload: string | Record<string, unknown>;
  attempt_count: number | string;
  max_attempts: number | string | null;
}

/**
 * Transactional Outbox Leasing Worker — system-guarantees.md rules 8 & 10:
 * "Outbox / job_outbox leasing: SELECT...FOR UPDATE SKIP LOCKED"
 * "at-most-once application of the persistent effect despite at-least-once delivery."
 */
export class OutboxLeaseManager {
  constructor(private readonly pool: Pool) {}

  /**
   * Leases a batch of pending or expired-retry outbox records using SELECT ... FOR UPDATE SKIP LOCKED.
   */
  public async leaseBatch(options: LeaseOptions): Promise<LeasedOutboxMessage[]> {
    const { workerId, batchSize = 10, leaseDurationSeconds = 30 } = options;

    return withTransaction(this.pool, async (connection: PoolConnection) => {
      const [rows] = await connection.query<OutboxRow[]>(SQL.LEASE_OUTBOX_BATCH, [batchSize]);

      if (rows.length === 0) {
        return [];
      }

      const leased: LeasedOutboxMessage[] = [];

      for (const row of rows) {
        const outboxId = row.outbox_id;
        await connection.query(SQL.UPDATE_OUTBOX_LEASED, [
          workerId,
          leaseDurationSeconds,
          outboxId,
        ]);

        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

        leased.push({
          outboxId: row.outbox_id,
          eventId: row.event_id,
          topic: row.topic,
          partitionKey: row.partition_key,
          payload,
          attemptCount: Number(row.attempt_count) + 1,
          maxAttempts: Number(row.max_attempts ?? 5),
        });
      }

      return leased;
    });
  }

  /**
   * Marks an outbox record as successfully published to Kafka.
   */
  public async markPublished(outboxId: string): Promise<void> {
    await this.pool.query(SQL.MARK_OUTBOX_PUBLISHED, [outboxId]);
  }

  /**
   * Marks an outbox record as failed, scheduling a retry if attempts remain or setting terminal FAILED.
   */
  public async markFailed(
    outboxId: string,
    error: Error | string,
    attemptCount: number,
    maxAttempts: number = 5,
    retryDelaySeconds: number = 10,
  ): Promise<'RETRY_SCHEDULED' | 'TERMINAL_FAILURE'> {
    const errorMessage = typeof error === 'string' ? error : (error.stack ?? error.message);

    if (attemptCount < maxAttempts) {
      await this.pool.query(SQL.MARK_OUTBOX_RETRY, [errorMessage, retryDelaySeconds, outboxId]);
      return 'RETRY_SCHEDULED';
    } else {
      await this.pool.query(SQL.MARK_OUTBOX_FAILED, [errorMessage, outboxId]);
      return 'TERMINAL_FAILURE';
    }
  }
}
