import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryOrderSummaryRepository } from '../repositories/in-memory-order-summary-repository.js';
import { computeProjectionHash } from '../hash/projection-hash.js';

describe('MongoDB Read Store — OrderSummaryRepository (Rules 5, 10, 11)', () => {
  let repo: InMemoryOrderSummaryRepository;

  beforeEach(() => {
    repo = new InMemoryOrderSummaryRepository();
  });

  it('keys documents strictly by composite `${timelineId}:${aggregateId}` (Rule 5)', async () => {
    const mainTimeline = '00000000-0000-0000-0000-000000000001';
    const branchTimeline = '00000000-0000-0000-0000-000000000002';
    const sharedAggregateId = 'order-12345';

    // Write state for MAIN
    await repo.upsertOrderSummary({
      timelineId: mainTimeline,
      aggregateId: sharedAggregateId,
      status: 'CONFIRMED',
      items: [{ sku: 'SKU-A', quantity: 1, amountMinor: 1000 }],
      totalAmountMinor: 1000,
      currency: 'INR',
      appliedSequence: 1,
      appliedTimelinePosition: 10,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 100,
      appliedEventId: 'ev-1',
      sourceAggregateSequence: 1,
      sourceStateHash: 'hash-main-1',
    });

    // Write different state for BRANCH with the SAME aggregateId
    await repo.upsertOrderSummary({
      timelineId: branchTimeline,
      aggregateId: sharedAggregateId,
      status: 'CANCELLED',
      items: [{ sku: 'SKU-A', quantity: 1, amountMinor: 1000 }],
      totalAmountMinor: 1000,
      currency: 'INR',
      appliedSequence: 1,
      appliedTimelinePosition: 20,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 105,
      appliedEventId: 'ev-2',
      sourceAggregateSequence: 1,
      sourceStateHash: 'hash-branch-1',
    });

    // Verify both documents exist independently and do not collide
    const mainDoc = await repo.findById(mainTimeline, sharedAggregateId);
    const branchDoc = await repo.findById(branchTimeline, sharedAggregateId);

    expect(mainDoc).not.toBeNull();
    expect(branchDoc).not.toBeNull();
    expect(mainDoc?._id).toBe(`${mainTimeline}:${sharedAggregateId}`);
    expect(branchDoc?._id).toBe(`${branchTimeline}:${sharedAggregateId}`);
    expect(mainDoc?.status).toBe('CONFIRMED');
    expect(branchDoc?.status).toBe('CANCELLED');
  });

  it('enforces sequence-guarded idempotency (Rule 10)', async () => {
    const timelineId = '00000000-0000-0000-0000-000000000001';
    const aggregateId = 'order-999';

    // First event at sequence 1
    const res1 = await repo.upsertOrderSummary({
      timelineId,
      aggregateId,
      status: 'CREATED',
      items: [],
      totalAmountMinor: 0,
      currency: 'INR',
      appliedSequence: 1,
      appliedTimelinePosition: 1,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 10,
      appliedEventId: 'ev-1',
      sourceAggregateSequence: 1,
      sourceStateHash: 'state-hash-1',
    });
    expect(res1.status).toBe('APPLIED');

    // Second event at sequence 2
    const res2 = await repo.upsertOrderSummary({
      timelineId,
      aggregateId,
      status: 'CONFIRMED',
      items: [{ sku: 'SKU-1', quantity: 2, amountMinor: 5000 }],
      totalAmountMinor: 5000,
      currency: 'INR',
      appliedSequence: 2,
      appliedTimelinePosition: 2,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 11,
      appliedEventId: 'ev-2',
      sourceAggregateSequence: 2,
      sourceStateHash: 'state-hash-2',
    });
    expect(res2.status).toBe('APPLIED');

    // Stale redelivery of sequence 1 must no-op and NOT overwrite sequence 2
    const resStale = await repo.upsertOrderSummary({
      timelineId,
      aggregateId,
      status: 'CREATED',
      items: [],
      totalAmountMinor: 0,
      currency: 'INR',
      appliedSequence: 1,
      appliedTimelinePosition: 1,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 10,
      appliedEventId: 'ev-1',
      sourceAggregateSequence: 1,
      sourceStateHash: 'state-hash-1',
    });
    expect(resStale.status).toBe('NOOP_STALE_SEQUENCE');

    // Verify current state remains at sequence 2
    const currentDoc = await repo.findById(timelineId, aggregateId);
    expect(currentDoc?.appliedSequence).toBe(2);
    expect(currentDoc?.status).toBe('CONFIRMED');
  });

  it('reconciles concurrent first-insert race without throwing (DuplicateKeyError handling)', async () => {
    const timelineId = '00000000-0000-0000-0000-000000000001';
    const aggregateId = 'order-race-1';

    repo.simulateFirstInsertRace = true;

    const res = await repo.upsertOrderSummary({
      timelineId,
      aggregateId,
      status: 'CREATED',
      items: [],
      totalAmountMinor: 0,
      currency: 'INR',
      appliedSequence: 1,
      appliedTimelinePosition: 1,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 1,
      appliedEventId: 'ev-1',
      sourceAggregateSequence: 1,
      sourceStateHash: 'state-hash-1',
    });

    expect(res.status).toBe('NOOP_ALREADY_APPLIED');
    const doc = await repo.findById(timelineId, aggregateId);
    expect(doc).not.toBeNull();
  });

  it('computes canonical projectionHash excluding transport metadata (Rule 11)', () => {
    const docA = {
      _id: 'MAIN:order-1',
      timelineId: 'MAIN',
      aggregateId: 'order-1',
      status: 'CONFIRMED',
      items: [{ sku: 'SKU-A', quantity: 2, amountMinor: 2000 }],
      totalAmountMinor: 2000,
      currency: 'INR',
      appliedSequence: 1,
      appliedTimelinePosition: 100,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 10,
      appliedEventId: 'ev-1',
      sourceAggregateSequence: 1,
      sourceStateHash: 'source-hash-1',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    // docB has identical business content but different transport and timestamp metadata
    const docB = {
      _id: 'MAIN:order-1',
      timelineId: 'MAIN',
      aggregateId: 'order-1',
      status: 'CONFIRMED',
      items: [{ sku: 'SKU-A', quantity: 2, amountMinor: 2000 }],
      totalAmountMinor: 2000,
      currency: 'INR',
      appliedSequence: 999, // bookkeeping field
      appliedTimelinePosition: 999, // bookkeeping field
      appliedKafkaTopic: 'other.topic', // bookkeeping field
      appliedKafkaPartition: 4, // bookkeeping field
      appliedKafkaOffset: 8888, // bookkeeping field
      appliedEventId: 'ev-other', // bookkeeping field
      sourceAggregateSequence: 1, // bookkeeping field
      sourceStateHash: 'source-hash-2', // bookkeeping field
      updatedAt: new Date('2026-09-21T12:00:00Z'), // bookkeeping field
    };

    const hashA = computeProjectionHash(docA);
    const hashB = computeProjectionHash(docB);

    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64);
  });
});
