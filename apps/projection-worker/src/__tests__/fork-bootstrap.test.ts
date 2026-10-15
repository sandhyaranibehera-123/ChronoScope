import { describe, it, expect, beforeEach } from 'vitest';
import type { DomainEvent } from '@chronoscope/domain';
import { InMemoryOrderSummaryRepository } from '@chronoscope/read-store';
import { InMemoryInboxCheckpointManager } from '@chronoscope/database';
import { InMemoryKafkaBus } from '@chronoscope/messaging';
import { ProjectionWorker } from '../worker.js';
import { ForkBaseStateResolver } from '../fork-base-resolver.js';

describe('Projection Worker — Fork-Base Bootstrap & Composite _id Isolation (Phase 7, Rules 5 & 13)', () => {
  let orderSummaryRepo: InMemoryOrderSummaryRepository;
  let inboxCheckpointManager: InMemoryInboxCheckpointManager;
  let kafkaBus: InMemoryKafkaBus;

  const mainTimelineId = '00000000-0000-0000-0000-000000000001';
  const branchTimelineId = 'branch-counterfactual-1';
  const sharedAggregateId = 'order-shared-123';

  beforeEach(() => {
    orderSummaryRepo = new InMemoryOrderSummaryRepository();
    inboxCheckpointManager = new InMemoryInboxCheckpointManager();
    kafkaBus = new InMemoryKafkaBus();
  });

  it('proves composite _id isolation: same aggregate_id across MAIN and BRANCH produces two independent documents (Rule 5)', async () => {
    const worker = new ProjectionWorker(orderSummaryRepo, inboxCheckpointManager, kafkaBus);

    // 1. Process OrderCreated on MAIN
    await worker.processMessage({
      topic: 'chronoscope.domain.events',
      partition: 0,
      offset: 100,
      timestamp: String(Date.now()),
      key: `${mainTimelineId}:${sharedAggregateId}`,
      headers: { eventId: 'ev-main-created' },
      value: {
        eventId: 'ev-main-created',
        timelineId: mainTimelineId,
        aggregateId: sharedAggregateId,
        aggregateSequence: 1,
        timelinePosition: 1,
        eventType: 'OrderCreated',
        payload: { currency: 'INR' },
        eventHash: 'hash-m1',
      },
    });

    // 2. Process OrderCreated on BRANCH (same aggregate_id!)
    await worker.processMessage({
      topic: 'chronoscope.domain.events',
      partition: 0,
      offset: 101,
      timestamp: String(Date.now()),
      key: `${branchTimelineId}:${sharedAggregateId}`,
      headers: { eventId: 'ev-branch-created' },
      value: {
        eventId: 'ev-branch-created',
        timelineId: branchTimelineId,
        aggregateId: sharedAggregateId,
        aggregateSequence: 1,
        timelinePosition: 5,
        eventType: 'OrderCreated',
        payload: { currency: 'USD' },
        eventHash: 'hash-b1',
      },
    });

    // Verify both documents exist separately in MongoDB (Rule 5)
    const docMain = await orderSummaryRepo.findById(mainTimelineId, sharedAggregateId);
    const docBranch = await orderSummaryRepo.findById(branchTimelineId, sharedAggregateId);

    expect(docMain).not.toBeNull();
    expect(docBranch).not.toBeNull();

    expect(docMain!._id).toBe(`${mainTimelineId}:${sharedAggregateId}`);
    expect(docBranch!._id).toBe(`${branchTimelineId}:${sharedAggregateId}`);

    expect(docMain!.currency).toBe('INR');
    expect(docBranch!.currency).toBe('USD');

    // Total documents in repo is 2
    const allDocs = await orderSummaryRepo.findAll();
    expect(allDocs).toHaveLength(2);
  });

  it('proves fork-base projection bootstrap: branch document includes pre-fork MAIN history (Rule 13)', async () => {
    // History on MAIN before the fork:
    // Event 1: OrderCreated
    // Event 2: OrderItemAdded (Item 1: 2 x 5000 = 10000)
    // Event 3: OrderConfirmed
    const mainEvents: DomainEvent[] = [
      {
        event_id: 'ev-m1',
        timeline_id: mainTimelineId,
        timeline_position: 1,
        aggregate_id: sharedAggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'OrderCreated',
        schema_version: 1,
        payload: { currency: 'INR' },
        event_hash: 'hash-m1',
        causation_id: null,
        correlation_id: 'corr-1',
        command_id: 'cmd-1',
        recorded_at: new Date().toISOString(),
      },
      {
        event_id: 'ev-m2',
        timeline_id: mainTimelineId,
        timeline_position: 2,
        aggregate_id: sharedAggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderItemAdded',
        schema_version: 1,
        payload: {
          sku: 'SKU-LAPTOP',
          quantity: 2,
          amountMinor: 5000,
        },
        event_hash: 'hash-m2',
        causation_id: 'ev-m1',
        correlation_id: 'corr-1',
        command_id: 'cmd-2',
        recorded_at: new Date().toISOString(),
      },
      {
        event_id: 'ev-m3',
        timeline_id: mainTimelineId,
        timeline_position: 3,
        aggregate_id: sharedAggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 3,
        event_type: 'OrderConfirmed',
        schema_version: 1,
        payload: {},
        event_hash: 'hash-m3',
        causation_id: 'ev-m2',
        correlation_id: 'corr-1',
        command_id: 'cmd-3',
        recorded_at: new Date().toISOString(),
      },
    ];

    // Timeline store stub:
    // MAIN is parent, branch forks at forkPosition = 3
    const mockTimelineReader = {
      async getTimeline(timelineId: string) {
        if (timelineId === branchTimelineId) {
          return {
            timelineId: branchTimelineId,
            parentTimelineId: mainTimelineId,
            forkPosition: 3,
          };
        }
        return {
          timelineId: mainTimelineId,
          parentTimelineId: null,
          forkPosition: 0,
        };
      },
      async getEffectiveEvents(timelineId: string, aggregateId?: string) {
        return mainEvents.filter((e) => (aggregateId ? e.aggregate_id === aggregateId : true));
      },
    };

    const forkBaseResolver = new ForkBaseStateResolver(mockTimelineReader);
    const worker = new ProjectionWorker(orderSummaryRepo, inboxCheckpointManager, kafkaBus, {
      forkBaseResolver,
    });

    // 1. Process MAIN events through projection worker
    for (let i = 0; i < mainEvents.length; i++) {
      const e = mainEvents[i]!;
      await worker.processMessage({
        topic: 'chronoscope.domain.events',
        partition: 0,
        offset: 200 + i,
        timestamp: String(Date.now()),
        key: `${mainTimelineId}:${sharedAggregateId}`,
        headers: { eventId: e.event_id },
        value: {
          eventId: e.event_id,
          timelineId: mainTimelineId,
          aggregateId: sharedAggregateId,
          aggregateSequence: e.aggregate_sequence,
          timelinePosition: e.timeline_position ?? 0,
          eventType: e.event_type,
          payload: e.payload,
          eventHash: e.event_hash,
        },
      });
    }

    // MAIN document should have status 'CONFIRMED' and 2 items
    const docMain = await orderSummaryRepo.findById(mainTimelineId, sharedAggregateId);
    expect(docMain).not.toBeNull();
    expect(docMain!.status).toBe('CONFIRMED');
    expect(docMain!.items).toHaveLength(1);
    expect(docMain!.items[0]!.sku).toBe('SKU-LAPTOP');
    expect(docMain!.totalAmountMinor).toBe(10000);

    // 2. Now on BRANCH, the first branch-local event arrives: OrderCancelled!
    // Notice: Kafka does NOT redeliver MAIN's past events to the branch;
    // The branch worker only receives the branch's local event: OrderCancelled!
    await worker.processMessage({
      topic: 'chronoscope.domain.events',
      partition: 0,
      offset: 300,
      timestamp: String(Date.now()),
      key: `${branchTimelineId}:${sharedAggregateId}`,
      headers: { eventId: 'ev-branch-cancelled' },
      value: {
        eventId: 'ev-branch-cancelled',
        timelineId: branchTimelineId,
        aggregateId: sharedAggregateId,
        aggregateSequence: 1, // branch-local sequence starts at 1 (Rule 13)
        timelinePosition: 10,
        eventType: 'OrderCancelled',
        payload: { reason: 'PAYMENT_FAILED_COUNTERFACTUAL' },
        eventHash: 'hash-b-cancel',
      },
    });

    // Verify BRANCH document in MongoDB:
    // It must have status 'CANCELLED'
    // AND it MUST retain the pre-fork items and amount inherited from MAIN (Rule 13)!
    const docBranch = await orderSummaryRepo.findById(branchTimelineId, sharedAggregateId);
    expect(docBranch).not.toBeNull();
    expect(docBranch!._id).toBe(`${branchTimelineId}:${sharedAggregateId}`);
    expect(docBranch!.status).toBe('CANCELLED');
    expect(docBranch!.items).toHaveLength(1);
    expect(docBranch!.items[0]!.sku).toBe('SKU-LAPTOP');
    expect(docBranch!.items[0]!.quantity).toBe(2);
    expect(docBranch!.totalAmountMinor).toBe(10000);
    expect(docBranch!.currency).toBe('INR');
  });
});
