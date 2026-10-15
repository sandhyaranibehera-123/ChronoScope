import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';
import { withTransaction } from '../transaction.js';
import type { IJobOutboxLeaseManager, JobLeaseOptions, LeasedJobOutboxMessage } from './types.js';

interface JobOutboxRow extends RowDataPacket {
  job_outbox_id: string;
  job_id: string;
  queue_name: string;
  payload: string | Record<string, unknown>;
  attempt_count: number | string;
  max_attempts: number | string;
}

/**
 * Job Outbox Leasing Manager — system-guarantees.md Rules 8 & 10 and ADR-005.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED to lease background jobs for RabbitMQ distribution.
 */
export class JobOutboxLeaseManager implements IJobOutboxLeaseManager {
  constructor(private readonly pool: Pool) {}

  public async leaseBatch(options: JobLeaseOptions): Promise<LeasedJobOutboxMessage[]> {
    const { workerId, batchSize = 10, leaseDurationSeconds = 30 } = options;

    return withTransaction(this.pool, async (connection: PoolConnection) => {
      const [rows] = await connection.query<JobOutboxRow[]>(SQL.LEASE_JOB_OUTBOX_BATCH, [
        batchSize,
      ]);

      if (rows.length === 0) {
        return [];
      }

      const leased: LeasedJobOutboxMessage[] = [];

      for (const row of rows) {
        const outboxId = row.job_outbox_id;
        await connection.query(SQL.UPDATE_JOB_OUTBOX_LEASED, [
          workerId,
          leaseDurationSeconds,
          outboxId,
        ]);

        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

        leased.push({
          jobOutboxId: row.job_outbox_id,
          jobId: row.job_id,
          queueName: row.queue_name,
          payload,
          attemptCount: Number(row.attempt_count) + 1,
          maxAttempts: Number(row.max_attempts),
        });
      }

      return leased;
    });
  }

  public async markPublished(jobOutboxId: string): Promise<void> {
    await this.pool.query(SQL.MARK_JOB_OUTBOX_PUBLISHED, [jobOutboxId]);
  }

  public async markFailed(
    jobOutboxId: string,
    error: Error | string,
    attemptCount: number,
    maxAttempts: number = 5,
    retryDelaySeconds: number = 10,
  ): Promise<'RETRY_SCHEDULED' | 'TERMINAL_FAILURE'> {
    const errorMessage = typeof error === 'string' ? error : (error.stack ?? error.message);

    if (attemptCount < maxAttempts) {
      await this.pool.query(SQL.MARK_JOB_OUTBOX_RETRY, [
        errorMessage,
        retryDelaySeconds,
        jobOutboxId,
      ]);
      return 'RETRY_SCHEDULED';
    } else {
      await this.pool.query(SQL.MARK_JOB_OUTBOX_FAILED, [errorMessage, jobOutboxId]);
      return 'TERMINAL_FAILURE';
    }
  }
}
