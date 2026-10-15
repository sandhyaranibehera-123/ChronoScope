import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryInboxCheckpointManager } from '@chronoscope/database';
import { InMemoryKafkaBus } from '@chronoscope/messaging';
import { InMemoryOrderSummaryRepository } from '@chronoscope/read-store';
import { ProjectionWorker } from '../worker.js';

describe('ProjectionWorker — Three-Step Cross-Engine Commit (Rules 10 & 17)', () => {
  let orderSummaryRepo: InMemoryOrderSummaryRepository;
  let inboxCheckpointManager: InMemoryInboxCheckpointManager;
  let kafkaBus: InMemoryKafkaBus;
  let worker: ProjectionWorker;

  const timelineId = '00000000-0000-0000-0000-000000000001';
  const aggregateId = 'order-test-100';

  beforeEach(() => {
    orderSummaryRepo = new InMemoryOrderSummaryRepository();
    inboxCheckpointManager = new InMemoryInboxCheckpointManager();
    kafkaBus = new InMemoryKafkaBus();

    worker = new ProjectionWorker(orderSummaryRepo, inboxCheckpointManager, kafkaBus, {
      projectionName: 'order_summary',
      consumerName: 'order_summary_worker',
    });
  });

  it('completes the three-step commit (Mongo upsert -> MySQL inbox/checkpoint -> Kafka offset commit)', async () => {
    const message = {
      topic: 'chronoscope.domain.events',
      key: `${timelineId}:${aggregateId}`,
      partition: 0,
      offset: 1042,
      value: {
        eventId: 'ev-test-1',
        timelineId,
        aggregateId,
        aggregateSequence: 1,
        timelinePosition: 50,
        eventType: 'OrderCreated',
        payload: { currency: 'INR' },
        eventHash: 'hash-ev-1',
      },
      headers: { eventId: 'ev-test-1' },
    };

    await worker.processMessage(message);

    // 1. Verify Step (a): Mongo document created
    const doc = await orderSummaryRepo.findById(timelineId, aggregateId);
    expect(doc).not.toBeNull();
    expect(doc?.appliedSequence).toBe(1);
    expect(doc?.appliedKafkaOffset).toBe(1042);

    // 2. Verify Step (b): MySQL inbox and checkpoint recorded
    const inInbox = await inboxCheckpointManager.isEventInInbox(
      'ev-test-1',
      'order_summary_worker',
    );
    expect(inInbox).toBe(true);

    const checkpoint = await inboxCheckpointManager.getCheckpoint(
      'order_summary',
      'chronoscope.domain.events',
      0,
    );
    expect(checkpoint).not.toBeNull();
    // Rule 10: checkpoint stores the LAST-PROCESSED offset (1042)
    expect(checkpoint?.kafkaOffset).toBe(1042);

    // 3. Verify Step (c): Kafka committed offset is offset + 1 (1043)
    const committedKafkaOffset = kafkaBus.getCommittedOffset('chronoscope.domain.events', 0);
    expect(committedKafkaOffset).toBe(1043);
    if (checkpoint) {
      expect(committedKafkaOffset).toBe(checkpoint.kafkaOffset + 1);
    }
  });

  it('absorbs redelivery safely: duplicate message produces byte-identical document and does not double-apply', async () => {
    const message = {
      topic: 'chronoscope.domain.events',
      key: `${timelineId}:${aggregateId}`,
      partition: 0,
      offset: 1042,
      value: {
        eventId: 'ev-test-1',
        timelineId,
        aggregateId,
        aggregateSequence: 1,
        timelinePosition: 50,
        eventType: 'OrderCreated',
        payload: { currency: 'INR' },
        eventHash: 'hash-ev-1',
      },
      headers: { eventId: 'ev-test-1' },
    };

    // First delivery
    await worker.processMessage(message);
    const docAfterFirst = await orderSummaryRepo.findById(timelineId, aggregateId);

    // Second redelivery of the exact same message
    await worker.processMessage(message);
    const docAfterSecond = await orderSummaryRepo.findById(timelineId, aggregateId);

    expect(docAfterSecond).toEqual(docAfterFirst);
    expect(worker.stats.duplicateCount).toBe(1);
  });

  it('recovers from crash injected AFTER Mongo upsert but BEFORE MySQL commit', async () => {
    const message = {
      topic: 'chronoscope.domain.events',
      key: `${timelineId}:${aggregateId}`,
      partition: 0,
      offset: 1042,
      value: {
        eventId: 'ev-crash-1',
        timelineId,
        aggregateId,
        aggregateSequence: 1,
        timelinePosition: 10,
        eventType: 'OrderCreated',
        payload: { currency: 'INR' },
        eventHash: 'hash-crash-1',
      },
      headers: { eventId: 'ev-crash-1' },
    };

    // Inject crash between (a) and (b)
    worker.crashSimulation = 'AFTER_MONGO_BEFORE_MYSQL';
    await expect(worker.processMessage(message)).rejects.toThrow('SIMULATED_CRASH');

    // Document was already written in Mongo
    const docPreRedelivery = await orderSummaryRepo.findById(timelineId, aggregateId);
    expect(docPreRedelivery).not.toBeNull();

    // MySQL inbox was NOT yet written
    expect(await inboxCheckpointManager.isEventInInbox('ev-crash-1', 'order_summary_worker')).toBe(
      false,
    );

    // Kafka offset was NOT yet committed
    expect(kafkaBus.getCommittedOffset('chronoscope.domain.events', 0)).toBeNull();

    // Recovery via Kafka redelivery without crash simulation
    worker.crashSimulation = 'NONE';
    await worker.processMessage(message);

    // Document in Mongo remains consistent and unchanged
    const docPostRedelivery = await orderSummaryRepo.findById(timelineId, aggregateId);
    expect(docPostRedelivery?.appliedSequence).toBe(1);

    // MySQL inbox and checkpoint now successfully recorded
    expect(await inboxCheckpointManager.isEventInInbox('ev-crash-1', 'order_summary_worker')).toBe(
      true,
    );
    const checkpoint = await inboxCheckpointManager.getCheckpoint(
      'order_summary',
      'chronoscope.domain.events',
      0,
    );
    expect(checkpoint?.kafkaOffset).toBe(1042);

    // Kafka offset now committed
    expect(kafkaBus.getCommittedOffset('chronoscope.domain.events', 0)).toBe(1043);
  });

  it('recovers from crash injected AFTER MySQL commit but BEFORE Kafka offset commit', async () => {
    const message = {
      topic: 'chronoscope.domain.events',
      key: `${timelineId}:${aggregateId}`,
      partition: 0,
      offset: 1042,
      value: {
        eventId: 'ev-crash-2',
        timelineId,
        aggregateId,
        aggregateSequence: 1,
        timelinePosition: 10,
        eventType: 'OrderCreated',
        payload: { currency: 'INR' },
        eventHash: 'hash-crash-2',
      },
      headers: { eventId: 'ev-crash-2' },
    };

    // Inject crash between (b) and (c)
    worker.crashSimulation = 'AFTER_MYSQL_BEFORE_KAFKA';
    await expect(worker.processMessage(message)).rejects.toThrow('SIMULATED_CRASH');

    // Both Mongo and MySQL succeeded before the crash
    expect(await orderSummaryRepo.findById(timelineId, aggregateId)).not.toBeNull();
    expect(await inboxCheckpointManager.isEventInInbox('ev-crash-2', 'order_summary_worker')).toBe(
      true,
    );

    // Kafka offset was NOT committed
    expect(kafkaBus.getCommittedOffset('chronoscope.domain.events', 0)).toBeNull();

    // Kafka redelivers the message; worker detects event in MySQL inbox and absorbs it safely
    worker.crashSimulation = 'NONE';
    await worker.processMessage(message);

    expect(worker.stats.duplicateCount).toBe(1);
    // Kafka offset is now committed without re-mutating Mongo
    expect(kafkaBus.getCommittedOffset('chronoscope.domain.events', 0)).toBe(1043);
  });
});
