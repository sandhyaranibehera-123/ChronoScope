import { describe, expect, it } from 'vitest';
import { InMemoryAggregateRepository } from '@chronoscope/database';
import { createDomainEvent } from '@chronoscope/events';
import { ConcurrencyError } from '@chronoscope/domain';

describe('Concurrency Proof: Row-Locked OCC vs Independent Aggregates (Rule 6)', () => {
  const TIMELINE_MAIN = '00000000-0000-0000-0000-000000000001';

  it('proves 100 independent aggregates append concurrently with zero lock contention', async () => {
    const repo = new InMemoryAggregateRepository<{ count: number }>('Counter');
    const AGGREGATE_COUNT = 100;

    // Launch 100 appends to 100 distinct aggregates concurrently
    const appendPromises = Array.from({ length: AGGREGATE_COUNT }, async (_, index) => {
      const aggregateId = `agg-independent-${index}`;
      const event = createDomainEvent({
        eventId: `evt-indep-${index}`,
        timelineId: TIMELINE_MAIN,
        aggregateId,
        aggregateType: 'Counter',
        aggregateSequence: 1,
        eventType: 'CounterInitialized',
        payload: { initial: index },
        correlationId: `corr-${index}`,
      });

      return repo.save(
        TIMELINE_MAIN,
        aggregateId,
        0, // expectedSequence
        [event],
        { count: index },
        `state-hash-${index}`.padEnd(64, '0'),
      );
    });

    const results = await Promise.all(appendPromises);

    // Every single independent aggregate must succeed
    expect(results).toHaveLength(AGGREGATE_COUNT);
    for (const res of results) {
      expect(res.success).toBe(true);
      expect(res.newSequence).toBe(1);
    }

    // Verify all 100 aggregates have valid independent state snapshots
    for (let i = 0; i < AGGREGATE_COUNT; i++) {
      const snapshot = await repo.load(TIMELINE_MAIN, `agg-independent-${i}`);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.sequence).toBe(1);
      expect(snapshot!.state.count).toBe(i);
    }

    // Verify global timeline_position was allocated monotonically (1 to 100)
    const allEvents = repo.getEvents(TIMELINE_MAIN);
    expect(allEvents).toHaveLength(AGGREGATE_COUNT);
    const positions = allEvents.map((e) => e.timelinePosition).sort((a, b) => a - b);
    expect(positions[0]).toBe(1);
    expect(positions[AGGREGATE_COUNT - 1]).toBe(AGGREGATE_COUNT);

    // Verify timeline head_position reached 100
    expect(repo.getHeadPosition(TIMELINE_MAIN)).toBe(AGGREGATE_COUNT);
  });

  it('proves racing appends to the same aggregate produce expected OCC conflict', async () => {
    const repo = new InMemoryAggregateRepository<{ balance: number }>('Account');
    const aggregateId = 'acc-contended-1';

    // Race 5 concurrent writers trying to append from expectedSequence = 0
    const RACING_WRITERS = 5;

    const raceResults = await Promise.allSettled(
      Array.from({ length: RACING_WRITERS }, async (_, writerIdx) => {
        const event = createDomainEvent({
          eventId: `evt-race-${writerIdx}`,
          timelineId: TIMELINE_MAIN,
          aggregateId,
          aggregateType: 'Account',
          aggregateSequence: 1,
          eventType: 'AccountOpened',
          payload: { writer: writerIdx, initialDeposit: 100 },
          correlationId: `corr-race-${writerIdx}`,
        });

        return repo.save(
          TIMELINE_MAIN,
          aggregateId,
          0, // All 5 race with expectedSequence = 0
          [event],
          { balance: 100 },
          `state-hash-race-${writerIdx}`.padEnd(64, '0'),
        );
      }),
    );

    const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
    const rejected = raceResults.filter((r) => r.status === 'rejected');

    // Exactly one writer must win the race
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(RACING_WRITERS - 1);

    // All rejected writers must receive ConcurrencyError
    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(ConcurrencyError);
        expect((rej.reason as ConcurrencyError).category).toBe('CONCURRENCY_CONFLICT');
      }
    }

    // The winning aggregate state remains at sequence 1, perfectly clean and uncorrupted
    const snapshot = await repo.load(TIMELINE_MAIN, aggregateId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.sequence).toBe(1);
    expect(repo.getEvents(TIMELINE_MAIN, aggregateId)).toHaveLength(1);
  });
});
