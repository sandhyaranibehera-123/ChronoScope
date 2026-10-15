import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';
import { withTransaction } from '../transaction.js';
import type { IJobManager, JobRecord, CreateJobOptions, JobStatus } from './types.js';

interface JobRow extends RowDataPacket {
  job_id: string;
  job_type: string;
  idempotency_key: string;
  status: JobStatus;
  payload: string | Record<string, unknown>;
  result_reference: string | null;
  error_message: string | null;
  attempt_count: number | string;
  max_attempts: number | string;
  scheduled_at: string | Date;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapJobRow<T>(row: JobRow): JobRecord<T> {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return {
    jobId: row.job_id,
    jobType: row.job_type,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    payload: payload as T,
    resultReference: row.result_reference,
    errorMessage: row.error_message,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    scheduledAt: new Date(row.scheduled_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class MysqlJobManager implements IJobManager {
  constructor(private readonly pool: Pool) {}

  public async createJob<T = unknown>(
    options: CreateJobOptions<T>,
  ): Promise<{ job: JobRecord<T>; isNew: boolean }> {
    return withTransaction(this.pool, async (connection: PoolConnection) => {
      // 1. Check if job already exists with this idempotency key (Rule 8)
      const [existingRows] = await connection.query<JobRow[]>(SQL.SELECT_JOB_BY_IDEMPOTENCY_KEY, [
        options.jobType,
        options.idempotencyKey,
      ]);

      if (existingRows.length > 0) {
        return {
          job: mapJobRow<T>(existingRows[0]!),
          isNew: false,
        };
      }

      // 2. Insert new job into chronoscope_ops.jobs
      const jobId = options.jobId ?? randomUUID();
      const jobOutboxId = randomUUID();
      const queueName = options.queueName ?? `chronoscope.jobs.${options.jobType.toLowerCase()}`;
      const payloadJson = JSON.stringify(options.payload);
      const maxAttempts = options.maxAttempts ?? 5;
      const scheduledAt = options.scheduledAt ? new Date(options.scheduledAt) : null;

      await connection.query(SQL.INSERT_JOB, [
        jobId,
        options.jobType,
        options.idempotencyKey,
        payloadJson,
        maxAttempts,
        scheduledAt,
      ]);

      // 3. Atomically enqueue into chronoscope_ops.job_outbox
      const outboxPayload = JSON.stringify({
        jobId,
        jobType: options.jobType,
        idempotencyKey: options.idempotencyKey,
        payload: options.payload,
      });

      await connection.query(SQL.INSERT_JOB_OUTBOX, [
        jobOutboxId,
        jobId,
        queueName,
        outboxPayload,
        maxAttempts,
      ]);

      const [freshRows] = await connection.query<JobRow[]>(SQL.SELECT_JOB_BY_ID, [jobId]);
      return {
        job: mapJobRow<T>(freshRows[0]!),
        isNew: true,
      };
    });
  }

  public async getJobById<T = unknown>(jobId: string): Promise<JobRecord<T> | null> {
    const [rows] = await this.pool.query<JobRow[]>(SQL.SELECT_JOB_BY_ID, [jobId]);
    if (rows.length === 0) return null;
    return mapJobRow<T>(rows[0]!);
  }

  public async getJobByIdempotencyKey<T = unknown>(
    jobType: string,
    idempotencyKey: string,
  ): Promise<JobRecord<T> | null> {
    const [rows] = await this.pool.query<JobRow[]>(SQL.SELECT_JOB_BY_IDEMPOTENCY_KEY, [
      jobType,
      idempotencyKey,
    ]);
    if (rows.length === 0) return null;
    return mapJobRow<T>(rows[0]!);
  }

  public async startJob(jobId: string): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>(SQL.UPDATE_JOB_RUNNING, [jobId]);
    return result.affectedRows > 0;
  }

  public async completeJob(jobId: string, resultReference: string | null = null): Promise<void> {
    await this.pool.query(SQL.UPDATE_JOB_COMPLETED, [resultReference, jobId]);
  }

  public async failJob(
    jobId: string,
    error: Error | string,
    retryDelaySeconds: number = 10,
  ): Promise<'RETRY_SCHEDULED' | 'TERMINAL_FAILURE'> {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const job = await this.getJobById(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.attemptCount < job.maxAttempts) {
      await this.pool.query(SQL.UPDATE_JOB_RETRY_PENDING, [errorMessage, retryDelaySeconds, jobId]);
      return 'RETRY_SCHEDULED';
    } else {
      await this.pool.query(SQL.UPDATE_JOB_FAILED, [errorMessage, jobId]);
      return 'TERMINAL_FAILURE';
    }
  }

  public async listJobs(limit: number = 50): Promise<JobRecord[]> {
    const [rows] = await this.pool.query<JobRow[]>(SQL.SELECT_JOBS_LIST, [limit]);
    return rows.map((r) => mapJobRow(r));
  }
}
