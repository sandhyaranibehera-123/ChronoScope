import { createLogger } from '@chronoscope/observability';
import type { IJobManager } from '@chronoscope/database';
import type { IRabbitMqConsumer, RabbitMqDelivery } from '@chronoscope/messaging';

const logger = createLogger({ name: 'job-worker' });

export type JobHandler<T = unknown> = (payload: T, jobId: string) => Promise<string | null | void>;

export interface JobWorkerOptions {
  queues?: string[];
  workerId?: string;
}

interface JobEnvelope<T = unknown> {
  jobId: string;
  jobType: string;
  idempotencyKey: string;
  payload: T;
}

/**
 * JobWorker — system-guarantees.md Rules 8 & 10 and ADR-005.
 *
 * Guarantees at-most-once application of persistent effects despite at-least-once delivery:
 * 1. Checks chronoscope_ops.jobs for terminal COMPLETED status. If found, acks without re-executing.
 * 2. Marks job RUNNING in MySQL.
 * 3. Executes registered job handler.
 * 4. Atomically updates job to COMPLETED with result_reference and acks message.
 * 5. On failure, delegates to JobManager for bounded retry budget (RETRY_PENDING vs FAILED).
 */
export class JobWorker {
  private readonly handlers = new Map<string, JobHandler<never>>();
  private isRunning = false;
  private readonly queues: string[];

  constructor(
    private readonly jobManager: IJobManager,
    private readonly consumer: IRabbitMqConsumer,
    options?: JobWorkerOptions,
  ) {
    this.queues = options?.queues ?? [
      'chronoscope.jobs.snapshot',
      'chronoscope.jobs.projection_rebuild',
      'chronoscope.jobs.export',
      'chronoscope.jobs.benchmark',
    ];
  }

  public registerHandler<T>(jobType: string, handler: JobHandler<T>): void {
    this.handlers.set(jobType, handler as JobHandler<never>);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    for (const queue of this.queues) {
      await this.consumer.consume<JobEnvelope>(queue, async (delivery) => {
        await this.processDelivery(delivery);
      });
      logger.info({ queue }, 'JobWorker subscribed to RabbitMQ work queue');
    }
  }

  public async processDelivery(delivery: RabbitMqDelivery<JobEnvelope>): Promise<void> {
    const envelope = delivery.message.payload;
    const jobId = envelope.jobId ?? delivery.message.headers?.['jobId'];

    if (!jobId) {
      logger.error(
        { messageId: delivery.message.id },
        'Received job message without jobId — rejecting to DLQ',
      );
      await delivery.reject();
      return;
    }

    // 1. Authoritative check in MySQL (Rule 8):
    const job = await this.jobManager.getJobById(jobId);
    if (!job) {
      logger.error({ jobId }, 'Job record not found in chronoscope_ops.jobs — rejecting');
      await delivery.reject();
      return;
    }

    // Idempotency: At-most-once application of persistent effect
    if (job.status === 'COMPLETED') {
      logger.info(
        { jobId, jobType: job.jobType },
        'Job already marked COMPLETED in MySQL — acknowledging redelivered message without re-execution (Rule 8)',
      );
      await delivery.ack();
      return;
    }

    // 2. Start job execution in MySQL
    await this.jobManager.startJob(jobId);

    const handler = this.handlers.get(job.jobType);
    if (!handler) {
      logger.warn(
        { jobType: job.jobType },
        'No handler registered for job type; marking completed as no-op',
      );
      await this.jobManager.completeJob(jobId, 'NO_OP_NO_HANDLER');
      await delivery.ack();
      return;
    }

    try {
      logger.info({ jobId, jobType: job.jobType }, 'Executing job handler...');
      const resultRef = await handler(envelope.payload as never, jobId);

      // 3. Mark COMPLETED with resultReference
      await this.jobManager.completeJob(jobId, resultRef ?? null);
      await delivery.ack();
      logger.info({ jobId, resultReference: resultRef }, 'Job completed successfully and acked');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ err, jobId }, 'Job execution failed');

      // 4. Update status in MySQL with retry budget
      const outcome = await this.jobManager.failJob(jobId, err);
      if (outcome === 'RETRY_SCHEDULED') {
        logger.warn({ jobId }, 'Job marked RETRY_PENDING — requeuing delivery');
        await delivery.nack(true);
      } else {
        logger.error({ jobId }, 'Job reached max attempts and marked FAILED — sending to DLQ');
        await delivery.reject();
      }
    }
  }

  public stop(): void {
    this.isRunning = false;
  }
}
