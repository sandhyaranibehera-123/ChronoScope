import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fc } from '@chronoscope/testing';
import { InMemoryAggregateRepository } from '@chronoscope/database';
import { createDomainEvent } from '@chronoscope/events';
import { ConcurrencyError } from '@chronoscope/domain';

describe('Property 3: Racing First-Insert OCC Invariant (Rule 5 & 6)', () => {
  const TIMELINE_ID = '00000000-0000-0000-0000-000000000001';

  it('proves that across arbitrary contending writer counts racing with expectedSequence=0, exactly 1 wins and N-1 receive ConcurrencyError', async () => {
    const raceSpecArb = fc.record({
      contendingWriters: fc.integer(2, 20),
      initialBalance: fc.integer(50, 500),
    });

    await fc.assert(
      raceSpecArb,
      async ({ contendingWriters, initialBalance }) => {
        const repo = new InMemoryAggregateRepository<{ balance: number }>('Account');
        const aggregateId = randomUUID();

        // Launch all contending writers simultaneously
        const racePromises = Array.from({ length: contendingWriters }, async (_, writerIdx) => {
          const event = createDomainEvent({
            eventId: randomUUID(),
            timelineId: TIMELINE_ID,
            aggregateId,
            aggregateType: 'Account',
            aggregateSequence: 1,
            eventType: 'AccountOpened',
            payload: { writer: writerIdx, balance: initialBalance },
            correlationId: `corr-race-${writerIdx}`,
          });

          return repo.save(
            TIMELINE_ID,
            aggregateId,
            0, // All writers race from expectedSequence = 0
            [event],
            { balance: initialBalance },
            `hash-${writerIdx}`.padEnd(64, '0'),
          );
        });

        const settledResults = await Promise.allSettled(racePromises);

        const fulfilled = settledResults.filter((r) => r.status === 'fulfilled');
        const rejected = settledResults.filter((r) => r.status === 'rejected');

        // INVARIANT 1: Exactly ONE writer wins the race
        expect(fulfilled).toHaveLength(1);

        // INVARIANT 2: Exactly (contendingWriters - 1) writers receive ConcurrencyError
        expect(rejected).toHaveLength(contendingWriters - 1);
        for (const rej of rejected) {
          if (rej.status === 'rejected') {
            expect(rej.reason).toBeInstanceOf(ConcurrencyError);
            expect((rej.reason as ConcurrencyError).category).toBe('CONCURRENCY_CONFLICT');
          }
        }

        // INVARIANT 3: Authoritative state in repository remains pristine at sequence 1
        const snapshot = await repo.load(TIMELINE_ID, aggregateId);
        expect(snapshot).not.toBeNull();
        expect(snapshot!.sequence).toBe(1);
        expect(snapshot!.state.balance).toBe(initialBalance);

        // INVARIANT 4: Exactly one event stored for this aggregate
        const storedEvents = repo.getEvents(TIMELINE_ID, aggregateId);
        expect(storedEvents).toHaveLength(1);
      },
      { runs: 25 },
    );
  });
});
