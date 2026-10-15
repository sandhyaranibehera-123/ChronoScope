import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryInboxCheckpointManager } from '@chronoscope/database';
import { InMemoryKafkaBus } from '@chronoscope/messaging';
import { InMemoryOrderSummaryRepository } from '@chronoscope/read-store';
import { ProjectionWorker } from '../worker.js';

describe('ProjectionWorker — Partition Ordering & Contiguous Offsets (Rule 10)', () => {
  let orderSummaryRepo: InMemoryOrderSummaryRepository;
  let inboxCheckpointManager: InMemoryInboxCheckpointManager;
  let kafkaBus: InMemoryKafkaBus;
  let worker: ProjectionWorker;

  const timelineId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    orderSummaryRepo = new InMemoryOrderSummaryRepository();
    inboxCheckpointManager = new InMemoryInboxCheckpointManager();
    kafkaBus = new InMemoryKafkaBus();

    worker = new ProjectionWorker(orderSummaryRepo, inboxCheckpointManager, kafkaBus, {
      projectionName: 'order_summary',
      consumerName: 'order_summary_worker',
    });
  });

  it('serializes processing per partition, keeping projection_checkpoints offset strictly contiguous', async () => {
    const partition = 1;
    const messages = [
      {
        topic: 'chronoscope.domain.events',
        key: `${timelineId}:order-1`,
        partition,
        offset: 100,
        value: {
          eventId: 'ev-100',
          timelineId,
          aggregateId: 'order-1',
          aggregateSequence: 1,
          timelinePosition: 1,
          eventType: 'OrderCreated',
          payload: {},
          eventHash: 'h-100',
        },
      },
      {
        topic: 'chronoscope.domain.events',
        key: `${timelineId}:order-2`,
        partition,
        offset: 101,
        value: {
          eventId: 'ev-101',
          timelineId,
          aggregateId: 'order-2',
          aggregateSequence: 1,
          timelinePosition: 2,
          eventType: 'OrderCreated',
          payload: {},
          eventHash: 'h-101',
        },
      },
      {
        topic: 'chronoscope.domain.events',
        key: `${timelineId}:order-3`,
        partition,
        offset: 102,
        value: {
          eventId: 'ev-102',
          timelineId,
          aggregateId: 'order-3',
          aggregateSequence: 1,
          timelinePosition: 3,
          eventType: 'OrderCreated',
          payload: {},
          eventHash: 'h-102',
        },
      },
    ];

    // Fire all three messages concurrently into the partition queue
    await Promise.all(messages.map((msg) => worker.handleMessageWithPartitionQueue(msg)));

    // Verify checkpoint advanced to 102 (the highest contiguous processed offset)
    const checkpoint = await inboxCheckpointManager.getCheckpoint(
      'order_summary',
      'chronoscope.domain.events',
      partition,
    );
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.kafkaOffset).toBe(102);
  });
});
