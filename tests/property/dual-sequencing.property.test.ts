import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fc } from '@chronoscope/testing';
import { InMemoryAggregateRepository } from '@chronoscope/database';
import { createDomainEvent } from '@chronoscope/events';
import { computeEventHash } from '@chronoscope/domain';

describe('Property 4: Dual-Sequencing Monotonicity & Three-Way Invariant (Rules 5, 6, 9)', () => {
  const TIMELINE_ID = '00000000-0000-0000-0000-000000000001';

  it('proves that across arbitrary multi-aggregate append workloads, aggregate_sequence is contiguous and timeline_position is strictly monotonic', async () => {
    const workloadArb = fc.record({
      aggregateCount: fc.integer(3, 10),
      eventsPerAggregate: fc.integer(2, 6),
    });

    await fc.assert(
      workloadArb,
      async ({ aggregateCount, eventsPerAggregate }) => {
        const repo = new InMemoryAggregateRepository<{ total: number }>('Accumulator');
        const aggregateIds = Array.from({ length: aggregateCount }, () => randomUUID());

        // For each aggregate, sequentially append eventsPerAggregate events
        for (const aggId of aggregateIds) {
          let runningTotal = 0;
          for (let seq = 1; seq <= eventsPerAggregate; seq++) {
            const delta = seq * 5;
            runningTotal += delta;
            const payload = { delta, total: runningTotal };

            const event = createDomainEvent({
              eventId: randomUUID(),
              timelineId: TIMELINE_ID,
              aggregateId: aggId,
              aggregateType: 'Accumulator',
              aggregateSequence: seq,
              eventType: 'TotalIncremented',
              payload,
              correlationId: `corr-${aggId}`,
            });

            // Verify three-way hash integrity
            expect(event.event_hash).toBe(computeEventHash(payload));

            const saveRes = await repo.save(
              TIMELINE_ID,
              aggId,
              seq - 1, // expectedSequence
              [event],
              { total: runningTotal },
              `hash-${aggId}-${seq}`.padEnd(64, '0'),
            );

            expect(saveRes.success).toBe(true);
            expect(saveRes.newSequence).toBe(seq);
          }
        }

        // 1. INVARIANT: Every aggregate's sequence is strictly contiguous (1 to eventsPerAggregate)
        for (const aggId of aggregateIds) {
          const events = repo.getEvents(TIMELINE_ID, aggId);
          expect(events).toHaveLength(eventsPerAggregate);

          for (let i = 0; i < eventsPerAggregate; i++) {
            expect(events[i]!.aggregateSequence).toBe(i + 1);
          }
        }

        // 2. INVARIANT: Global timeline_position across the timeline is strictly monotonically increasing
        const allEvents = repo.getEvents(TIMELINE_ID);
        const expectedTotalEvents = aggregateCount * eventsPerAggregate;
        expect(allEvents).toHaveLength(expectedTotalEvents);

        const positions = allEvents.map((e) => e.timelinePosition);
        // Check uniqueness and monotonic sorting
        for (let i = 1; i < positions.length; i++) {
          expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
        }

        // 3. INVARIANT: Timeline head_position equals the last timelinePosition
        expect(repo.getHeadPosition(TIMELINE_ID)).toBe(positions[positions.length - 1]);
      },
      { runs: 20 },
    );
  });
});
