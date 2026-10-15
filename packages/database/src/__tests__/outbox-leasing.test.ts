import { describe, expect, it } from 'vitest';
import { InMemoryAggregateRepository } from '../repositories/in-memory-aggregate-repository.js';

describe('Transactional Outbox Pattern (Rules 8 & 10)', () => {
  it('enqueues outbox records with composite partition key during event append', async () => {
    const repo = new InMemoryAggregateRepository<{ total: number }>('Order');
    const timelineId = '00000000-0000-0000-0000-000000000001';
    const aggregateId = 'ord-100';

    const events = [
      {
        event_id: 'evt-100-1',
        timeline_id: timelineId,
        aggregate_id: aggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'OrderCreated',
        schema_version: 1,
        payload: { customerId: 'cust-1' },
        event_hash: 'a'.repeat(64),
        causation_id: null,
        correlation_id: 'corr-100',
        recorded_at: new Date().toISOString(),
      },
      {
        event_id: 'evt-100-2',
        timeline_id: timelineId,
        aggregate_id: aggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderConfirmed',
        schema_version: 1,
        payload: { totalAmountMinor: 1000 },
        event_hash: 'b'.repeat(64),
        causation_id: 'evt-100-1',
        correlation_id: 'corr-100',
        recorded_at: new Date().toISOString(),
      },
    ];

    const result = await repo.save(
      timelineId,
      aggregateId,
      0,
      events,
      { total: 1000 },
      'hash-state-1',
    );

    expect(result.success).toBe(true);
    expect(result.newSequence).toBe(2);

    const outboxRecords = repo.getOutbox('PENDING');
    expect(outboxRecords).toHaveLength(2);

    // Rule 10: partition key is strictly `${timelineId}:${aggregateId}`
    expect(outboxRecords[0]!.partitionKey).toBe(`${timelineId}:${aggregateId}`);
    expect(outboxRecords[0]!.eventId).toBe('evt-100-1');
    expect(outboxRecords[0]!.topic).toBe('chronoscope.domain.events');

    expect(outboxRecords[1]!.partitionKey).toBe(`${timelineId}:${aggregateId}`);
    expect(outboxRecords[1]!.eventId).toBe('evt-100-2');
  });

  it('maintains head_position cached high-water mark on timeline', async () => {
    const repo = new InMemoryAggregateRepository<{ count: number }>('Counter');
    const timelineId = '00000000-0000-0000-0000-000000000001';

    await repo.save(
      timelineId,
      'counter-1',
      0,
      [
        {
          event_id: 'evt-c1',
          timeline_id: timelineId,
          aggregate_id: 'counter-1',
          aggregate_type: 'Counter',
          aggregate_sequence: 1,
          event_type: 'Incremented',
          schema_version: 1,
          payload: { delta: 1 },
          event_hash: 'c'.repeat(64),
          causation_id: null,
          correlation_id: 'corr-c1',
          recorded_at: new Date().toISOString(),
        },
      ],
      { count: 1 },
      'hash-c1',
    );

    expect(repo.getHeadPosition(timelineId)).toBe(1);

    await repo.save(
      timelineId,
      'counter-2',
      0,
      [
        {
          event_id: 'evt-c2',
          timeline_id: timelineId,
          aggregate_id: 'counter-2',
          aggregate_type: 'Counter',
          aggregate_sequence: 1,
          event_type: 'Incremented',
          schema_version: 1,
          payload: { delta: 5 },
          event_hash: 'd'.repeat(64),
          causation_id: null,
          correlation_id: 'corr-c2',
          recorded_at: new Date().toISOString(),
        },
      ],
      { count: 5 },
      'hash-c2',
    );

    expect(repo.getHeadPosition(timelineId)).toBe(2);
  });
});
