/**
 * Strongly typed Job models and options — Rules 8, 10 and ADR-005.
 */

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'RETRY_PENDING' | 'FAILED';
export type JobOutboxStatus = 'PENDING' | 'LEASED' | 'PUBLISHED' | 'RETRY_PENDING' | 'FAILED';

export interface JobRecord<T = unknown> {
  jobId: string;
  jobType: string;
  idempotencyKey: string;
  status: JobStatus;
  payload: T;
  resultReference: string | null;
  errorMessage: string | null;
  attemptCount: number;
  maxAttempts: number;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobOptions<T = unknown> {
  jobId?: string | undefined;
  jobType: string;
  idempotencyKey: string;
  payload: T;
  queueName?: string | undefined;
  maxAttempts?: number | undefined;
  scheduledAt?: string | undefined;
}

export interface LeasedJobOutboxMessage<T = unknown> {
  jobOutboxId: string;
  jobId: string;
  queueName: string;
  payload: T;
  attemptCount: number;
  maxAttempts: number;
}

export interface JobLeaseOptions {
  workerId: string;
  batchSize?: number | undefined;
  leaseDurationSeconds?: number | undefined;
}

export interface IJobManager {
  createJob<T = unknown>(
    options: CreateJobOptions<T>,
  ): Promise<{ job: JobRecord<T>; isNew: boolean }>;
  getJobById<T = unknown>(jobId: string): Promise<JobRecord<T> | null>;
  getJobByIdempotencyKey<T = unknown>(
    jobType: string,
    idempotencyKey: string,
  ): Promise<JobRecord<T> | null>;
  startJob(jobId: string): Promise<boolean>;
  completeJob(jobId: string, resultReference?: string | null | undefined): Promise<void>;
  failJob(
    jobId: string,
    error: Error | string,
    retryDelaySeconds?: number | undefined,
  ): Promise<'RETRY_SCHEDULED' | 'TERMINAL_FAILURE'>;
  listJobs(limit?: number | undefined): Promise<JobRecord[]>;
}

export interface IJobOutboxLeaseManager {
  leaseBatch(options: JobLeaseOptions): Promise<LeasedJobOutboxMessage[]>;
  markPublished(jobOutboxId: string): Promise<void>;
  markFailed(
    jobOutboxId: string,
    error: Error | string,
    attemptCount: number,
    maxAttempts?: number,
    retryDelaySeconds?: number,
  ): Promise<'RETRY_SCHEDULED' | 'TERMINAL_FAILURE'>;
}
