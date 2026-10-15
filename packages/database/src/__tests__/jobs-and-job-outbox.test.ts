import { describe, expect, it } from 'vitest';
import {
  InMemoryJobManager,
  InMemoryJobOutboxLeaseManager,
} from '../jobs/in-memory-job-manager.js';

describe('Job Lifecycle & Job Outbox (Rules 8 & 10, ADR-005)', () => {
  it('creates a job and transactionally enqueues a job_outbox record', async () => {
    const jobManager = new InMemoryJobManager();
    const result = await jobManager.createJob({
      jobType: 'PROJECTION_REBUILD',
      idempotencyKey: 'rebuild-order-summary-1',
      payload: { projectionName: 'order_summary', runId: 'run-001' },
    });

    expect(result.isNew).toBe(true);
    expect(result.job.jobId).toBeDefined();
    expect(result.job.status).toBe('PENDING');
    expect(result.job.attemptCount).toBe(0);

    // Outbox verification
    expect(jobManager.outboxRecords).toHaveLength(1);
    const outbox = jobManager.outboxRecords[0]!;
    expect(outbox.jobId).toBe(result.job.jobId);
    expect(outbox.queueName).toBe('chronoscope.jobs.projection_rebuild');
    expect(outbox.status).toBe('PENDING');
  });

  it('enforces job idempotency by (job_type, idempotency_key) returning existing record (Rule 8)', async () => {
    const jobManager = new InMemoryJobManager();

    const first = await jobManager.createJob({
      jobType: 'SNAPSHOT_GENERATION',
      idempotencyKey: 'snapshot-order-1-seq-5',
      payload: { aggregateId: 'order-1', sequence: 5 },
    });
    expect(first.isNew).toBe(true);

    const second = await jobManager.createJob({
      jobType: 'SNAPSHOT_GENERATION',
      idempotencyKey: 'snapshot-order-1-seq-5',
      payload: { aggregateId: 'order-1', sequence: 5 },
    });
    expect(second.isNew).toBe(false);
    expect(second.job.jobId).toBe(first.job.jobId);
    expect(jobManager.outboxRecords).toHaveLength(1); // No duplicate outbox record
  });

  it('transitions job through RUNNING, COMPLETED and stores result_reference', async () => {
    const jobManager = new InMemoryJobManager();
    const { job } = await jobManager.createJob({
      jobType: 'EXPORT',
      idempotencyKey: 'export-timelines-2026',
      payload: { format: 'parquet' },
    });

    const started = await jobManager.startJob(job.jobId);
    expect(started).toBe(true);

    const running = await jobManager.getJobById(job.jobId);
    expect(running?.status).toBe('RUNNING');
    expect(running?.attemptCount).toBe(1);
    expect(running?.startedAt).toBeDefined();

    await jobManager.completeJob(job.jobId, 's3://minio/exports/timelines-2026.parquet');
    const completed = await jobManager.getJobById(job.jobId);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.resultReference).toBe('s3://minio/exports/timelines-2026.parquet');
    expect(completed?.completedAt).toBeDefined();
  });

  it('manages retry budgets with RETRY_PENDING before terminal FAILED (Rule 8)', async () => {
    const jobManager = new InMemoryJobManager();
    const { job } = await jobManager.createJob({
      jobType: 'BENCHMARK',
      idempotencyKey: 'bench-001',
      payload: { durationSeconds: 60 },
      maxAttempts: 2,
    });

    await jobManager.startJob(job.jobId);
    const retryRes = await jobManager.failJob(job.jobId, new Error('Network timeout'), 5);
    expect(retryRes).toBe('RETRY_SCHEDULED');

    const retrying = await jobManager.getJobById(job.jobId);
    expect(retrying?.status).toBe('RETRY_PENDING');
    expect(retrying?.errorMessage).toBe('Network timeout');

    // Second attempt fails terminally
    await jobManager.startJob(job.jobId);
    const termRes = await jobManager.failJob(job.jobId, new Error('Fatal crash'));
    expect(termRes).toBe('TERMINAL_FAILURE');

    const failed = await jobManager.getJobById(job.jobId);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.errorMessage).toBe('Fatal crash');
  });

  it('leases outbox records using SKIP LOCKED semantics and marks published', async () => {
    const jobManager = new InMemoryJobManager();
    const leaseManager = new InMemoryJobOutboxLeaseManager(jobManager);

    await jobManager.createJob({
      jobType: 'PROJECTION_REBUILD',
      idempotencyKey: 'rebuild-1',
      payload: { projection: 'order_summary' },
    });
    await jobManager.createJob({
      jobType: 'PROJECTION_REBUILD',
      idempotencyKey: 'rebuild-2',
      payload: { projection: 'payment_summary' },
    });

    const batch = await leaseManager.leaseBatch({
      workerId: 'worker-a',
      batchSize: 10,
      leaseDurationSeconds: 15,
    });

    expect(batch).toHaveLength(2);
    expect(batch[0]?.attemptCount).toBe(1);

    // Empty second lease because records are already LEASED
    const secondBatch = await leaseManager.leaseBatch({
      workerId: 'worker-b',
      batchSize: 10,
    });
    expect(secondBatch).toHaveLength(0);

    // Mark first published
    await leaseManager.markPublished(batch[0]!.jobOutboxId);
    expect(jobManager.outboxRecords[0]!.status).toBe('PUBLISHED');
  });
});
