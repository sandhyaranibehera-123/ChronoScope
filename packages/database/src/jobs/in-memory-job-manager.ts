import { randomUUID } from 'node:crypto';
import type {
  IJobManager,
  IJobOutboxLeaseManager,
  JobRecord,
  CreateJobOptions,
  JobLeaseOptions,
  LeasedJobOutboxMessage,
  JobOutboxStatus,
} from './types.js';

export interface InMemoryJobOutboxRecord {
  jobOutboxId: string;
  jobId: string;
  queueName: string;
  payload: unknown;
  status: JobOutboxStatus;
  leasedBy: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  errorMessage: string | null;
  createdAt: string;
}

export class InMemoryJobManager implements IJobManager {
  private readonly jobsById = new Map<string, JobRecord>();
  private readonly jobsByKey = new Map<string, JobRecord>();
  public readonly outboxRecords: InMemoryJobOutboxRecord[] = [];

  public async createJob<T = unknown>(
    options: CreateJobOptions<T>,
  ): Promise<{ job: JobRecord<T>; isNew: boolean }> {
    const key = `${options.jobType}:${options.idempotencyKey}`;
    const existing = this.jobsByKey.get(key);

    if (existing) {
      return {
        job: existing as JobRecord<T>,
        isNew: false,
      };
    }

    const now = new Date().toISOString();
    const jobId = options.jobId ?? randomUUID();
    const jobRecord: JobRecord<T> = {
      jobId,
      jobType: options.jobType,
      idempotencyKey: options.idempotencyKey,
      status: 'PENDING',
      payload: options.payload,
      resultReference: null,
      errorMessage: null,
      attemptCount: 0,
      maxAttempts: options.maxAttempts ?? 5,
      scheduledAt: options.scheduledAt ?? now,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.jobsById.set(jobId, jobRecord as JobRecord);
    this.jobsByKey.set(key, jobRecord as JobRecord);

    // Enqueue to outbox
    const jobOutboxId = randomUUID();
    const queueName = options.queueName ?? `chronoscope.jobs.${options.jobType.toLowerCase()}`;

    this.outboxRecords.push({
      jobOutboxId,
      jobId,
      queueName,
      payload: {
        jobId,
        jobType: options.jobType,
        idempotencyKey: options.idempotencyKey,
        payload: options.payload,
      },
      status: 'PENDING',
      leasedBy: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      maxAttempts: options.maxAttempts ?? 5,
      errorMessage: null,
      createdAt: now,
    });

    return {
      job: jobRecord,
      isNew: true,
    };
  }

  public async getJobById<T = unknown>(jobId: string): Promise<JobRecord<T> | null> {
    const job = this.jobsById.get(jobId);
    return job ? (job as JobRecord<T>) : null;
  }

  public async getJobByIdempotencyKey<T = unknown>(
    jobType: string,
    idempotencyKey: string,
  ): Promise<JobRecord<T> | null> {
    const key = `${jobType}:${idempotencyKey}`;
    const job = this.jobsByKey.get(key);
    return job ? (job as JobRecord<T>) : null;
  }

  public async startJob(jobId: string): Promise<boolean> {
    const job = this.jobsById.get(jobId);
    if (!job) return false;
    if (job.status !== 'PENDING' && job.status !== 'RETRY_PENDING') return false;

    job.status = 'RUNNING';
    job.attemptCount += 1;
    job.startedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    return true;
  }

  public async completeJob(jobId: string, resultReference: string | null = null): Promise<void> {
    const job = this.jobsById.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    job.status = 'COMPLETED';
    job.resultReference = resultReference;
    job.completedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
  }

  public async failJob(
    jobId: string,
    error: Error | string,
    retryDelaySeconds: number = 10,
  ): Promise<'RETRY_SCHEDULED' | 'TERMINAL_FAILURE'> {
    const job = this.jobsById.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const errorMessage = typeof error === 'string' ? error : error.message;
    const now = new Date();

    if (job.attemptCount < job.maxAttempts) {
      job.status = 'RETRY_PENDING';
      job.errorMessage = errorMessage;
      job.scheduledAt = new Date(now.getTime() + retryDelaySeconds * 1000).toISOString();
      job.updatedAt = now.toISOString();
      return 'RETRY_SCHEDULED';
    } else {
      job.status = 'FAILED';
      job.errorMessage = errorMessage;
      job.completedAt = now.toISOString();
      job.updatedAt = now.toISOString();
      return 'TERMINAL_FAILURE';
    }
  }

  public async listJobs(limit: number = 50): Promise<JobRecord[]> {
    return Array.from(this.jobsById.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  public clear(): void {
    this.jobsById.clear();
    this.jobsByKey.clear();
    this.outboxRecords.length = 0;
  }
}

export class InMemoryJobOutboxLeaseManager implements IJobOutboxLeaseManager {
  constructor(private readonly jobManager: InMemoryJobManager) {}

  public async leaseBatch(options: JobLeaseOptions): Promise<LeasedJobOutboxMessage[]> {
    const { workerId, batchSize = 10, leaseDurationSeconds = 30 } = options;
    const now = new Date();
    const leased: LeasedJobOutboxMessage[] = [];

    for (const record of this.jobManager.outboxRecords) {
      if (leased.length >= batchSize) break;

      const isExpired =
        record.leaseExpiresAt && new Date(record.leaseExpiresAt).getTime() < now.getTime();

      if (
        record.status === 'PENDING' ||
        (record.status === 'LEASED' && isExpired) ||
        (record.status === 'RETRY_PENDING' && isExpired)
      ) {
        record.status = 'LEASED';
        record.leasedBy = workerId;
        record.leaseExpiresAt = new Date(now.getTime() + leaseDurationSeconds * 1000).toISOString();
        record.attemptCount += 1;

        leased.push({
          jobOutboxId: record.jobOutboxId,
          jobId: record.jobId,
          queueName: record.queueName,
          payload: record.payload,
          attemptCount: record.attemptCount,
          maxAttempts: record.maxAttempts,
        });
      }
    }

    return leased;
  }

  public async markPublished(jobOutboxId: string): Promise<void> {
    const record = this.jobManager.outboxRecords.find((r) => r.jobOutboxId === jobOutboxId);
    if (record) {
      record.status = 'PUBLISHED';
    }
  }

  public async markFailed(
    jobOutboxId: string,
    error: Error | string,
    attemptCount: number,
    maxAttempts: number = 5,
    retryDelaySeconds: number = 10,
  ): Promise<'RETRY_SCHEDULED' | 'TERMINAL_FAILURE'> {
    const record = this.jobManager.outboxRecords.find((r) => r.jobOutboxId === jobOutboxId);
    if (!record) return 'TERMINAL_FAILURE';

    const errorMessage = typeof error === 'string' ? error : (error.stack ?? error.message);
    const now = new Date();

    if (attemptCount < maxAttempts) {
      record.status = 'RETRY_PENDING';
      record.errorMessage = errorMessage;
      record.leaseExpiresAt = new Date(now.getTime() + retryDelaySeconds * 1000).toISOString();
      return 'RETRY_SCHEDULED';
    } else {
      record.status = 'FAILED';
      record.errorMessage = errorMessage;
      return 'TERMINAL_FAILURE';
    }
  }
}
