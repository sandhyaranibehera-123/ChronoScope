import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryKafkaBus } from '../kafka/in-memory-bus.js';
import { OutboxPublisher } from '../outbox/publisher.js';
import type { OutboxLeaseManager, LeasedOutboxMessage } from '@chronoscope/database';

describe('Messaging — OutboxPublisher (Rules 8, 10)', () => {
  let bus: InMemoryKafkaBus;
  let leasedMessages: LeasedOutboxMessage[];
  let publishedIds: string[];
  let failedIds: string[];
  let mockLeaseManager: OutboxLeaseManager;

  beforeEach(() => {
    bus = new InMemoryKafkaBus();
    leasedMessages = [];
    publishedIds = [];
    failedIds = [];

    mockLeaseManager = {
      leaseBatch: async () => [...leasedMessages],
      markPublished: async (outboxId: string) => {
        publishedIds.push(outboxId);
      },
      markFailed: async (outboxId: string) => {
        failedIds.push(outboxId);
        return 'RETRY_SCHEDULED';
      },
    } as unknown as OutboxLeaseManager;
  });

  it('publishes leased messages to Kafka maintaining composite partition key', async () => {
    const publisher = new OutboxPublisher(mockLeaseManager, bus, {
      workerId: 'worker-1',
    });

    const timelineId = '00000000-0000-0000-0000-000000000001';
    const aggregateId = 'order-abc-1';
    const compositeKey = `${timelineId}:${aggregateId}`;

    leasedMessages.push({
      outboxId: 'outbox-1',
      eventId: 'ev-1',
      topic: 'chronoscope.domain.events',
      partitionKey: compositeKey,
      payload: { eventType: 'OrderCreated', aggregateId },
      attemptCount: 1,
      maxAttempts: 5,
    });

    const { publishedCount, errorCount } = await publisher.publishBatch();

    expect(publishedCount).toBe(1);
    expect(errorCount).toBe(0);
    expect(publishedIds).toContain('outbox-1');
  });

  it('handles publish failure and reports to lease manager for retry scheduling', async () => {
    const failingProducer = {
      connect: async () => {},
      disconnect: async () => {},
      send: async () => {
        throw new Error('Kafka connection reset');
      },
    };

    const publisher = new OutboxPublisher(mockLeaseManager, failingProducer, {
      workerId: 'worker-1',
    });

    leasedMessages.push({
      outboxId: 'outbox-failing',
      eventId: 'ev-fail',
      topic: 'chronoscope.domain.events',
      partitionKey: 'timeline:order-fail',
      payload: { eventType: 'OrderCreated' },
      attemptCount: 1,
      maxAttempts: 5,
    });

    const { publishedCount, errorCount } = await publisher.publishBatch();

    expect(publishedCount).toBe(0);
    expect(errorCount).toBe(1);
    expect(failedIds).toContain('outbox-failing');
    expect(publishedIds).toHaveLength(0);
  });
});
