import type { IJobOutboxLeaseManager, LeasedJobOutboxMessage } from '@chronoscope/database';
import { createLogger } from '@chronoscope/observability';
import type { IRabbitMqProducer } from '../rabbitmq/types.js';

export interface JobOutboxPublisherOptions {
  readonly workerId: string;
  readonly batchSize?: number;
  readonly leaseDurationSeconds?: number;
  readonly pollIntervalMs?: number;
}

const logger = createLogger({ name: 'job-outbox-publisher' });

/**
 * Reliable Job Outbox Publisher — system-guarantees.md Rules 8 & 10 and ADR-005.
 * Bridges transactional job_outbox in MySQL (chronoscope_ops) to RabbitMQ work queue.
 */
export class JobOutboxPublisher {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly leaseManager: IJobOutboxLeaseManager,
    private readonly producer: IRabbitMqProducer,
    private readonly options: JobOutboxPublisherOptions,
  ) {}

  public async publishBatch(): Promise<{ publishedCount: number; errorCount: number }> {
    const leased = await this.leaseManager.leaseBatch({
      workerId: this.options.workerId,
      batchSize: this.options.batchSize ?? 10,
      leaseDurationSeconds: this.options.leaseDurationSeconds ?? 30,
    });

    if (leased.length === 0) {
      return { publishedCount: 0, errorCount: 0 };
    }

    let publishedCount = 0;
    let errorCount = 0;

    for (const msg of leased) {
      try {
        await this.publishSingle(msg);
        publishedCount++;
      } catch (error) {
        errorCount++;
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(
          { err, jobOutboxId: msg.jobOutboxId },
          'Failed to publish job_outbox record to RabbitMQ',
        );
        await this.leaseManager.markFailed(msg.jobOutboxId, err, msg.attemptCount, msg.maxAttempts);
      }
    }

    return { publishedCount, errorCount };
  }

  private async publishSingle(msg: LeasedJobOutboxMessage): Promise<void> {
    await this.producer.publish(msg.queueName, msg.payload, {
      jobId: msg.jobId,
      jobOutboxId: msg.jobOutboxId,
      attemptCount: String(msg.attemptCount),
    });

    await this.leaseManager.markPublished(msg.jobOutboxId);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.publishBatch();
      } catch (err) {
        logger.error({ err }, 'Error during job outbox publish loop poll');
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(poll, this.options.pollIntervalMs ?? 100);
        }
      }
    };

    poll().catch(() => {});
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
