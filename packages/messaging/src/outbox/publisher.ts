import type { OutboxLeaseManager, LeasedOutboxMessage } from '@chronoscope/database';
import { createLogger } from '@chronoscope/observability';
import type { IKafkaProducer } from '../types.js';

export interface OutboxPublisherOptions {
  readonly workerId: string;
  readonly batchSize?: number;
  readonly leaseDurationSeconds?: number;
  readonly pollIntervalMs?: number;
}

const logger = createLogger({ name: 'outbox-publisher' });

/**
 * Reliable Outbox Publisher — system-guarantees.md Rules 8 & 10.
 * Bridges transactional outbox in MySQL to Kafka event backbone.
 */
export class OutboxPublisher {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly leaseManager: OutboxLeaseManager,
    private readonly producer: IKafkaProducer,
    private readonly options: OutboxPublisherOptions,
  ) {}

  /**
   * Processes a single batch of leased outbox records.
   */
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
        logger.error({ err, outboxId: msg.outboxId }, 'Failed to publish outbox record to Kafka');
        await this.leaseManager.markFailed(msg.outboxId, err, msg.attemptCount, msg.maxAttempts);
      }
    }

    return { publishedCount, errorCount };
  }

  private async publishSingle(msg: LeasedOutboxMessage): Promise<void> {
    await this.producer.send(msg.topic, msg.partitionKey, msg.payload, {
      eventId: msg.eventId,
      attemptCount: String(msg.attemptCount),
    });

    await this.leaseManager.markPublished(msg.outboxId);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.publishBatch();
      } catch (err) {
        logger.error({ err }, 'Error during outbox publish loop poll');
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
