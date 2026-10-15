import { describe, it, expect, beforeEach } from 'vitest';
import { PreconditionFailedError } from '@chronoscope/domain';
import { InMemoryAggregateRepository, InMemoryScenarioInputManager } from '../index.js';

describe('Database — Timeline Ancestry & Scenario Inputs (Phase 7, Rules 6, 12, 13)', () => {
  let repository: InMemoryAggregateRepository<{ count: number }>;
  let scenarioManager: InMemoryScenarioInputManager;
  const mainTimelineId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    repository = new InMemoryAggregateRepository<{ count: number }>('Order');
    scenarioManager = new InMemoryScenarioInputManager();
  });

  it('validates fork position against parent timeline head (Rule 6)', async () => {
    // MAIN has no events yet, max position is 0
    // Forking at position 0 is valid
    const branch1 = repository.createTimeline({
      timelineId: 'branch-1',
      parentTimelineId: mainTimelineId,
      forkPosition: 0,
      name: 'Branch 1',
    });
    expect(branch1.timelineId).toBe('branch-1');
    expect(branch1.forkPosition).toBe(0);

    // Forking with negative position fails
    expect(() => {
      repository.createTimeline({
        timelineId: 'branch-invalid-neg',
        parentTimelineId: mainTimelineId,
        forkPosition: -1,
        name: 'Invalid Neg',
      });
    }).toThrow(PreconditionFailedError);

    // Forking with position exceeding parent max position fails
    expect(() => {
      repository.createTimeline({
        timelineId: 'branch-invalid-high',
        parentTimelineId: mainTimelineId,
        forkPosition: 999,
        name: 'Invalid High',
      });
    }).toThrow(PreconditionFailedError);
  });

  it('proves sibling isolation and nested branching in EffectiveHistory (Rule 13 & ADR-010)', async () => {
    // 1. Append 3 events to MAIN
    const aggregateId = 'agg-1';
    await repository.save(
      mainTimelineId,
      aggregateId,
      0,
      [
        {
          event_id: 'ev-main-1',
          aggregate_id: aggregateId,
          event_type: 'ItemAdded',
          schema_version: 1,
          payload: { count: 1 },
          event_hash: 'hash-1',
          causation_id: null,
          correlation_id: 'corr-1',
          recorded_at: new Date().toISOString(),
        } as never,
        {
          event_id: 'ev-main-2',
          aggregate_id: aggregateId,
          event_type: 'ItemAdded',
          schema_version: 1,
          payload: { count: 2 },
          event_hash: 'hash-2',
          causation_id: null,
          correlation_id: 'corr-1',
          recorded_at: new Date().toISOString(),
        } as never,
      ],
      { count: 2 },
      'state-hash-2',
    );

    // Timeline positions on MAIN are 1, 2
    expect(repository.getHeadPosition(mainTimelineId)).toBe(2);

    // 2. Fork BRANCH-A from MAIN at fork_position = 2
    const branchA = repository.createTimeline({
      timelineId: 'branch-a',
      parentTimelineId: mainTimelineId,
      forkPosition: 2,
      name: 'Branch A',
    });
    expect(branchA.forkPosition).toBe(2);

    // 3. Fork sibling BRANCH-B from MAIN at fork_position = 2
    const branchB = repository.createTimeline({
      timelineId: 'branch-b',
      parentTimelineId: mainTimelineId,
      forkPosition: 2,
      name: 'Branch B',
    });
    expect(branchB.forkPosition).toBe(2);

    // 4. Append 3rd event to MAIN (happens AFTER the fork at position 3)
    await repository.save(
      mainTimelineId,
      aggregateId,
      2,
      [
        {
          event_id: 'ev-main-3',
          aggregate_id: aggregateId,
          event_type: 'ItemAdded',
          schema_version: 1,
          payload: { count: 3 },
          event_hash: 'hash-3',
          causation_id: null,
          correlation_id: 'corr-1',
          recorded_at: new Date().toISOString(),
        } as never,
      ],
      { count: 3 },
      'state-hash-3',
    );
    expect(repository.getHeadPosition(mainTimelineId)).toBe(3);

    // 5. Append branch-local events to BRANCH-A (starting sequence 1 per Rule 13)
    await repository.save(
      'branch-a',
      aggregateId,
      0,
      [
        {
          event_id: 'ev-branch-a-1',
          aggregate_id: aggregateId,
          event_type: 'ItemAdded',
          schema_version: 1,
          payload: { count: 10 },
          event_hash: 'hash-a1',
          causation_id: null,
          correlation_id: 'corr-a',
          recorded_at: new Date().toISOString(),
        } as never,
      ],
      { count: 12 },
      'state-hash-a1',
    );

    // 6. Append branch-local events to BRANCH-B
    await repository.save(
      'branch-b',
      aggregateId,
      0,
      [
        {
          event_id: 'ev-branch-b-1',
          aggregate_id: aggregateId,
          event_type: 'ItemAdded',
          schema_version: 1,
          payload: { count: 20 },
          event_hash: 'hash-b1',
          causation_id: null,
          correlation_id: 'corr-b',
          recorded_at: new Date().toISOString(),
        } as never,
      ],
      { count: 22 },
      'state-hash-b1',
    );

    // Verify Sibling Isolation (Rule 13):
    // EffectiveHistory(BRANCH-A) has ev-main-1, ev-main-2, ev-branch-a-1
    // It must NOT have ev-main-3 (occurred after fork_position 2)
    // It must NOT have ev-branch-b-1 (sibling isolation)
    const effectiveA = repository.getEffectiveEvents('branch-a', aggregateId);
    const eventIdsA = effectiveA.map((e) => e.eventId);
    expect(eventIdsA).toEqual(['ev-main-1', 'ev-main-2', 'ev-branch-a-1']);
    expect(eventIdsA).not.toContain('ev-main-3');
    expect(eventIdsA).not.toContain('ev-branch-b-1');

    // EffectiveHistory(BRANCH-B) has ev-main-1, ev-main-2, ev-branch-b-1
    const effectiveB = repository.getEffectiveEvents('branch-b', aggregateId);
    const eventIdsB = effectiveB.map((e) => e.eventId);
    expect(eventIdsB).toEqual(['ev-main-1', 'ev-main-2', 'ev-branch-b-1']);
    expect(eventIdsB).not.toContain('ev-main-3');
    expect(eventIdsB).not.toContain('ev-branch-a-1');

    // 7. Nested branch: BRANCH-C forked from BRANCH-A at position 4
    const headPosA = repository.getHeadPosition('branch-a');
    expect(headPosA).toBe(4); // ev-main-1(1), ev-main-2(2), ev-main-3(3), ev-branch-a-1(4)

    repository.createTimeline({
      timelineId: 'branch-c',
      parentTimelineId: 'branch-a',
      forkPosition: headPosA,
      name: 'Branch C (nested)',
    });

    await repository.save(
      'branch-c',
      aggregateId,
      0,
      [
        {
          event_id: 'ev-branch-c-1',
          aggregate_id: aggregateId,
          event_type: 'ItemAdded',
          schema_version: 1,
          payload: { count: 30 },
          event_hash: 'hash-c1',
          causation_id: null,
          correlation_id: 'corr-c',
          recorded_at: new Date().toISOString(),
        } as never,
      ],
      { count: 42 },
      'state-hash-c1',
    );

    // EffectiveHistory(BRANCH-C) recursively gathers:
    // MAIN (<= 2) + BRANCH-A (<= 4) + BRANCH-C local
    const effectiveC = repository.getEffectiveEvents('branch-c', aggregateId);
    const eventIdsC = effectiveC.map((e) => e.eventId);
    expect(eventIdsC).toEqual(['ev-main-1', 'ev-main-2', 'ev-branch-a-1', 'ev-branch-c-1']);
  });

  it('manages persisted scenario inputs (Rule 12 & 27)', async () => {
    const input = await scenarioManager.recordInput({
      timelineId: 'branch-a',
      aggregateId: 'order-123',
      inputType: 'ForcePaymentFailure',
      parameters: { reason: 'SIMULATED_DECLINED' },
    });

    expect(input.inputId).toBeDefined();
    expect(input.inputType).toBe('ForcePaymentFailure');
    expect(input.applied).toBe(false);

    const retrieved = await scenarioManager.getInputsByTimeline('branch-a');
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]!.inputType).toBe('ForcePaymentFailure');

    await scenarioManager.markApplied(input.inputId);
    const updated = await scenarioManager.getInputsByTimeline('branch-a');
    expect(updated[0]!.applied).toBe(true);
  });

  it('materializes aggregate on branch at sequence 0 with inherited state (Rule 13)', async () => {
    repository.materializeBranchAggregate('branch-a', 'order-123', { count: 50 }, 'hash-inherited');

    const snapshot = await repository.load('branch-a', 'order-123');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.sequence).toBe(0);
    expect(snapshot!.state).toEqual({ count: 50 });
    expect(snapshot!.stateHash).toBe('hash-inherited');
  });
});
