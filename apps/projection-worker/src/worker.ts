import { createLogger } from '@chronoscope/observability';
import type { IInboxCheckpointManager } from '@chronoscope/database';
import type { IKafkaConsumer, KafkaMessageEnvelope } from '@chronoscope/messaging';
import type { IOrderSummaryRepository, OrderSummaryDocument } from '@chronoscope/read-store';
import { getProjectionPartitionFenceName } from './fence.js';
import type { IForkBaseStateResolver, ForkBaseOrderSummary } from './fork-base-resolver.js';

export type CrashSimulationMode = 'NONE' | 'AFTER_MONGO_BEFORE_MYSQL' | 'AFTER_MYSQL_BEFORE_KAFKA';

export interface ProjectionWorkerOptions {
  readonly projectionName?: string | undefined;
  readonly consumerName?: string | undefined;
  readonly lockTimeoutSeconds?: number | undefined;
  readonly forkBaseResolver?: IForkBaseStateResolver | undefined;
  crashSimulation?: CrashSimulationMode | undefined;
}

const logger = createLogger({ name: 'projection-worker' });

export interface ProcessedStats {
  appliedCount: number;
  duplicateCount: number;
  pausedCount: number;
}

/**
 * Projection Worker implementing the three-step cross-engine commit (Rule 10).
 *
 * Sequence of persistent effects:
 *   1. Acquire MySQL advisory fence (Rule 17) & verify projection_metadata.status == ACTIVE.
 *   2. Step (a): Idempotent, sequence-guarded MongoDB upsert (w:1, j:true, composite _id).
 *   3. Step (b): MySQL transaction committing inbox dedup and advancing projection_checkpoints.
 *   4. Step (c): Kafka offset commit.
 *   5. Release MySQL advisory fence.
 *
 * Enforces strictly ONE in-flight upsert per Kafka partition so projection_checkpoints.kafka_offset
 * remains a contiguous high-water mark.
 */
export class ProjectionWorker {
  private readonly projectionName: string;
  private readonly consumerName: string;
  private readonly lockTimeoutSeconds: number;
  private readonly forkBaseResolver?: IForkBaseStateResolver | undefined;
  public crashSimulation: CrashSimulationMode;

  // In-process partition serialization queues (Rule 10)
  private readonly partitionLocks = new Map<number, Promise<void>>();

  public stats: ProcessedStats = {
    appliedCount: 0,
    duplicateCount: 0,
    pausedCount: 0,
  };

  constructor(
    private readonly orderSummaryRepo: IOrderSummaryRepository,
    private readonly inboxCheckpointManager: IInboxCheckpointManager,
    private readonly consumer: IKafkaConsumer,
    options?: ProjectionWorkerOptions,
  ) {
    this.projectionName = options?.projectionName ?? 'order_summary';
    this.consumerName = options?.consumerName ?? 'order_summary_worker';
    this.lockTimeoutSeconds = options?.lockTimeoutSeconds ?? 5;
    this.forkBaseResolver = options?.forkBaseResolver;
    this.crashSimulation = options?.crashSimulation ?? 'NONE';
  }

  /**
   * Starts consuming from Kafka topics.
   */
  public async start(topics: string[] = ['chronoscope.domain.events']): Promise<void> {
    await this.consumer.subscribe(topics, async (message: KafkaMessageEnvelope) => {
      await this.handleMessageWithPartitionQueue(message);
    });
  }

  /**
   * Wraps message processing in a partition-level mutex to enforce Rule 10's
   * "one in-flight upsert per Kafka partition per projection" guarantee.
   */
  public async handleMessageWithPartitionQueue(message: KafkaMessageEnvelope): Promise<void> {
    const partition = message.partition;
    const currentQueue = this.partitionLocks.get(partition) ?? Promise.resolve();

    const nextQueue = currentQueue.then(async () => {
      await this.processMessage(message);
    });

    this.partitionLocks.set(
      partition,
      nextQueue.catch(() => {}),
    );
    return nextQueue;
  }

  /**
   * Core processing method executing the exact 3-step commit order (Rule 10).
   */
  public async processMessage(message: KafkaMessageEnvelope): Promise<void> {
    const event = this.extractEventData(message);
    if (!event) {
      logger.warn({ message }, 'Skipping malformed message with no event identity');
      return;
    }

    // 0. Redelivery short-circuit check: if already recorded in MySQL inbox, absorb safely
    const alreadyInInbox = await this.inboxCheckpointManager.isEventInInbox(
      event.eventId,
      this.consumerName,
    );

    if (alreadyInInbox) {
      this.stats.duplicateCount++;
      // Absorbed without touching Mongo again (Rule 10)
      await this.consumer.commitOffset(message.topic, message.partition, message.offset);
      return;
    }

    // 1. Acquire MySQL advisory fence (Rule 17)
    const fenceName = getProjectionPartitionFenceName(this.projectionName, message.partition);
    const acquired = await this.inboxCheckpointManager.acquireAdvisoryLock(
      fenceName,
      this.lockTimeoutSeconds,
    );

    if (!acquired) {
      throw new Error(`Failed to acquire projection fence '${fenceName}' within timeout`);
    }

    try {
      // Check projection status (Rule 17)
      const metadata = await this.inboxCheckpointManager.getProjectionStatus(this.projectionName);
      if (metadata && metadata.status !== 'ACTIVE') {
        logger.info(
          { status: metadata.status, projectionName: this.projectionName },
          'Projection is not ACTIVE — pausing writes',
        );
        this.stats.pausedCount++;
        return;
      }

      // Check existing document in MongoDB
      const existingDoc = await this.orderSummaryRepo.findById(event.timelineId, event.aggregateId);

      // If document does not exist yet, resolve fork-base state from MySQL ancestor history (Rule 13)
      let baseState: ForkBaseOrderSummary | null = existingDoc
        ? {
            status: existingDoc.status,
            items: existingDoc.items,
            totalAmountMinor: existingDoc.totalAmountMinor,
            currency: existingDoc.currency,
          }
        : null;

      if (!baseState && this.forkBaseResolver) {
        baseState = await this.forkBaseResolver.resolveForkBaseState(
          event.timelineId,
          event.aggregateId,
        );
      }

      // Step (a): Idempotent MongoDB upsert (Rule 10)
      const docInput = this.deriveOrderSummaryDoc(event, message, baseState);
      await this.orderSummaryRepo.upsertOrderSummary(docInput);

      // Fault injection point 1
      if (this.crashSimulation === 'AFTER_MONGO_BEFORE_MYSQL') {
        throw new Error('SIMULATED_CRASH: crash after MongoDB upsert, before MySQL commit');
      }

      // Step (b): MySQL transaction with inbox insert and checkpoint update (Rule 10)
      await this.inboxCheckpointManager.recordInboxAndCheckpoint({
        eventId: event.eventId,
        consumerName: this.consumerName,
        projectionName: this.projectionName,
        topic: message.topic,
        kafkaPartition: message.partition,
        kafkaOffset: message.offset, // Stored as LAST-PROCESSED offset
      });

      // Fault injection point 2
      if (this.crashSimulation === 'AFTER_MYSQL_BEFORE_KAFKA') {
        throw new Error('SIMULATED_CRASH: crash after MySQL commit, before Kafka offset commit');
      }

      // Step (c): Kafka offset commit (Rule 10)
      await this.consumer.commitOffset(message.topic, message.partition, message.offset);

      this.stats.appliedCount++;
    } finally {
      // Release advisory fence
      await this.inboxCheckpointManager.releaseAdvisoryLock(fenceName);
    }
  }

  private extractEventData(message: KafkaMessageEnvelope): {
    eventId: string;
    timelineId: string;
    aggregateId: string;
    aggregateSequence: number;
    timelinePosition: number;
    eventType: string;
    payload: Record<string, unknown>;
    eventHash: string;
  } | null {
    const val = message.value as Record<string, unknown> | null;
    if (!val) return null;

    const eventId = String(message.headers?.['eventId'] ?? val['eventId'] ?? val['event_id'] ?? '');
    const timelineId = String(
      val['timelineId'] ?? val['timeline_id'] ?? '00000000-0000-0000-0000-000000000001',
    );
    const aggregateId = String(val['aggregateId'] ?? val['aggregate_id'] ?? '');
    const aggregateSequence = Number(val['aggregateSequence'] ?? val['aggregate_sequence'] ?? 1);
    const timelinePosition = Number(val['timelinePosition'] ?? val['timeline_position'] ?? 1);
    const eventType = String(val['eventType'] ?? val['event_type'] ?? '');
    const payload = (val['payload'] ?? {}) as Record<string, unknown>;
    const eventHash = String(val['eventHash'] ?? val['event_hash'] ?? '');

    if (!eventId || !aggregateId) {
      return null;
    }

    return {
      eventId,
      timelineId,
      aggregateId,
      aggregateSequence,
      timelinePosition,
      eventType,
      payload,
      eventHash,
    };
  }

  private deriveOrderSummaryDoc(
    event: NonNullable<ReturnType<ProjectionWorker['extractEventData']>>,
    message: KafkaMessageEnvelope,
    baseState?: ForkBaseOrderSummary | null,
  ): Omit<OrderSummaryDocument, 'projectionHash' | 'updatedAt'> {
    let status = baseState?.status ?? 'CREATED';
    const items: Array<{ sku: string; quantity: number; amountMinor: number }> = baseState
      ? [...baseState.items]
      : [];
    let totalAmountMinor = baseState?.totalAmountMinor ?? 0;
    let currency = baseState?.currency ?? 'INR';

    if (event.eventType === 'OrderCreated') {
      status = 'CREATED';
      currency = String(event.payload['currency'] ?? event.payload['currency_id'] ?? currency);
    } else if (event.eventType === 'OrderItemAdded') {
      const itemObj = (event.payload['item'] ?? event.payload) as Record<string, unknown>;
      const sku = String(itemObj['sku'] ?? 'DEFAULT-SKU');
      const quantity = Number(itemObj['quantity'] ?? 1);
      const amountMinor = Number(
        itemObj['unitAmountMinor'] ?? itemObj['amountMinor'] ?? itemObj['unit_amount_minor'] ?? 0,
      );
      items.push({ sku, quantity, amountMinor });
      totalAmountMinor += amountMinor * quantity;
    } else if (event.eventType === 'OrderConfirmed') {
      status = 'CONFIRMED';
    } else if (event.eventType === 'OrderPaid') {
      status = 'PAID';
    } else if (event.eventType === 'OrderCancelled') {
      status = 'CANCELLED';
    }

    return {
      _id: `${event.timelineId}:${event.aggregateId}`,
      timelineId: event.timelineId,
      aggregateId: event.aggregateId,
      status,
      items,
      totalAmountMinor,
      currency,
      appliedSequence: event.aggregateSequence,
      appliedTimelinePosition: event.timelinePosition,
      appliedKafkaTopic: message.topic,
      appliedKafkaPartition: message.partition,
      appliedKafkaOffset: message.offset,
      appliedEventId: event.eventId,
      sourceAggregateSequence: event.aggregateSequence,
      sourceStateHash: event.eventHash,
    };
  }
}
