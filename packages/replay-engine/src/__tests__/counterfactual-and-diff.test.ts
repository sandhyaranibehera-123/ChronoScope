import { describe, it, expect, beforeEach } from 'vitest';
import { type DomainEvent, computeStateHash, type OrderState } from '@chronoscope/domain';
import {
  InMemoryExecutionManager,
  InMemoryScenarioInputManager,
  type ScenarioInputRecord,
} from '@chronoscope/database';
import {
  findCommonAncestor,
  evaluateScenarioInputs,
  TimelineDiffEngine,
  CounterfactualReplayService,
  InMemoryEventReader,
} from '../index.js';

describe('Replay Engine — Counterfactual Execution & Diff (Phase 7, Rules 9, 11, 12, 13)', () => {
  let executionManager: InMemoryExecutionManager;
  let scenarioManager: InMemoryScenarioInputManager;

  beforeEach(() => {
    executionManager = new InMemoryExecutionManager();
    scenarioManager = new InMemoryScenarioInputManager();
  });

  it('finds nearest common ancestor between timeline ancestries', () => {
    // MAIN -> BRANCH_A -> BRANCH_C
    // MAIN -> BRANCH_B
    const ancestryC = [
      { timelineId: 'branch-c', parentTimelineId: 'branch-a', forkPosition: 5, depth: 0 },
      { timelineId: 'branch-a', parentTimelineId: 'main', forkPosition: 2, depth: 1 },
      { timelineId: 'main', parentTimelineId: null, forkPosition: 0, depth: 2 },
    ];

    const ancestryB = [
      { timelineId: 'branch-b', parentTimelineId: 'main', forkPosition: 2, depth: 0 },
      { timelineId: 'main', parentTimelineId: null, forkPosition: 0, depth: 1 },
    ];

    const match = findCommonAncestor(ancestryC, ancestryB);
    expect(match).not.toBeNull();
    expect(match!.commonAncestorTimelineId).toBe('main');
    expect(match!.forkPositionB).toBe(2);
  });

  it('evaluates scenario inputs correctly', () => {
    const rawInputs: ScenarioInputRecord[] = [
      {
        inputId: '1',
        timelineId: 'branch-a',
        aggregateId: 'order-1',
        inputType: 'ForcePaymentFailure',
        parameters: null,
        applied: false,
        createdAt: new Date().toISOString(),
      },
      {
        inputId: '2',
        timelineId: 'branch-a',
        aggregateId: 'order-1',
        inputType: 'InjectDelay',
        parameters: { delayMs: 250 },
        applied: false,
        createdAt: new Date().toISOString(),
      },
    ];

    const evaluated = evaluateScenarioInputs(rawInputs, 'order-1');
    expect(evaluated.forcePaymentFailure).toBe(true);
    expect(evaluated.delayMs).toBe(250);
  });

  it('executes COUNTERFACTUAL_REPLAY and asserts live/replay hash parity (Rule 9 & 12)', async () => {
    const timelineId = 'branch-cf';
    const aggregateId = 'order-cf';

    const events: DomainEvent[] = [
      {
        event_id: 'e1',
        timeline_id: timelineId,
        timeline_position: 1,
        aggregate_id: aggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'OrderCreated',
        schema_version: 1,
        payload: {
          customer_id: 'cust-1',
          currency: 'INR',
        },
        event_hash: 'hash-e1',
        causation_id: null,
        correlation_id: 'corr-1',
        command_id: 'cmd-1',
        recorded_at: new Date().toISOString(),
      },
      {
        event_id: 'e2',
        timeline_id: timelineId,
        timeline_position: 2,
        aggregate_id: aggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderItemAdded',
        schema_version: 1,
        payload: {
          item: {
            sku: 'SKU-ITEM',
            quantity: 2,
            unitAmountMinor: 5000n,
            totalAmountMinor: 10000n,
          },
        },
        event_hash: 'hash-e2',
        causation_id: 'e1',
        correlation_id: 'corr-1',
        command_id: 'cmd-2',
        recorded_at: new Date().toISOString(),
      },
      {
        event_id: 'e3',
        timeline_id: timelineId,
        timeline_position: 3,
        aggregate_id: aggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 3,
        event_type: 'OrderCancelled',
        schema_version: 1,
        payload: {
          reason: 'PAYMENT_FAILED_SIMULATION',
        },
        event_hash: 'hash-e3',
        causation_id: 'e2',
        correlation_id: 'corr-1',
        command_id: 'cmd-3',
        recorded_at: new Date().toISOString(),
      },
    ];

    const eventReader = new InMemoryEventReader(events);

    // Compute expected live state
    const expectedState: OrderState = {
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      customer_id: 'cust-1',
      currency: 'INR',
      status: 'CANCELLED',
      items: [
        {
          sku: 'SKU-ITEM',
          quantity: 2,
          unitAmountMinor: 5000n,
          totalAmountMinor: 10000n,
        },
      ],
      total_amount_minor: 10000n,
      cancellation_reason: 'PAYMENT_FAILED_SIMULATION',
      created_at: events[0]!.recorded_at,
      updated_at: events[2]!.recorded_at,
    };

    const expectedHash = computeStateHash(expectedState);

    const liveStateProvider = {
      async getLiveState() {
        return {
          sequence: 3,
          state: expectedState,
          stateHash: expectedHash,
        };
      },
    };

    await scenarioManager.recordInput({
      timelineId,
      aggregateId,
      inputType: 'ForcePaymentFailure',
      parameters: { reason: 'TEST_FAIL' },
    });

    const replayService = new CounterfactualReplayService(
      eventReader,
      executionManager,
      scenarioManager,
      liveStateProvider,
    );

    const result = await replayService.replayAggregate({
      timelineId,
      aggregateId,
      aggregateType: 'Order',
    });

    expect(result.eventsReplayed).toBe(3);
    expect(result.toSequence).toBe(3);
    expect(result.stateHash).toBe(expectedHash);
    expect(result.hashParityMatched).toBe(true);

    // Verify record in execution manager
    const auditRecord = await executionManager.getExecution(result.executionId);
    expect(auditRecord).not.toBeNull();
    expect(auditRecord!.mode).toBe('COUNTERFACTUAL_REPLAY');
    expect(auditRecord!.status).toBe('COMPLETED');
    expect(auditRecord!.hashParityMatched).toBe(true);
  });

  it('diffs two timelines and identifies divergence reason', async () => {
    const mainTimelineId = 'main';
    const branchTimelineId = 'branch-fail';
    const aggregateId = 'order-diff';

    const eventsMain: DomainEvent[] = [
      {
        event_id: 'm1',
        timeline_id: mainTimelineId,
        timeline_position: 1,
        aggregate_id: aggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'OrderCreated',
        schema_version: 1,
        payload: { orderId: aggregateId },
        event_hash: 'h-m1',
        causation_id: null,
        correlation_id: 'c1',
        command_id: 'cmd-1',
        recorded_at: new Date().toISOString(),
      },
      {
        event_id: 'm2',
        timeline_id: mainTimelineId,
        timeline_position: 2,
        aggregate_id: aggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderPaid',
        schema_version: 1,
        payload: { orderId: aggregateId },
        event_hash: 'h-m2',
        causation_id: 'm1',
        correlation_id: 'c1',
        command_id: 'cmd-2',
        recorded_at: new Date().toISOString(),
      },
    ];

    const eventsBranch: DomainEvent[] = [
      eventsMain[0]!, // pre-fork event
      {
        event_id: 'b2',
        timeline_id: branchTimelineId,
        timeline_position: 3,
        aggregate_id: aggregateId,
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderCancelled',
        schema_version: 1,
        payload: { orderId: aggregateId, reason: 'PAYMENT_FAILED' },
        event_hash: 'h-b2',
        causation_id: 'm1',
        correlation_id: 'c2',
        command_id: 'cmd-b2',
        recorded_at: new Date().toISOString(),
      },
    ];

    const mockProvider = {
      async getState(timelineId: string) {
        if (timelineId === mainTimelineId) {
          return { state: { status: 'PAID' }, stateHash: 'hash-paid' };
        }
        return { state: { status: 'CANCELLED' }, stateHash: 'hash-cancelled' };
      },
      async getAncestry(timelineId: string) {
        if (timelineId === mainTimelineId) {
          return [
            { timelineId: mainTimelineId, parentTimelineId: null, forkPosition: 0, depth: 0 },
          ];
        }
        return [
          {
            timelineId: branchTimelineId,
            parentTimelineId: mainTimelineId,
            forkPosition: 1,
            depth: 0,
          },
          { timelineId: mainTimelineId, parentTimelineId: null, forkPosition: 0, depth: 1 },
        ];
      },
      async getEffectiveEvents(timelineId: string) {
        return timelineId === mainTimelineId ? eventsMain : eventsBranch;
      },
      async getScenarioInputs() {
        return [
          {
            inputId: 'si-1',
            timelineId: branchTimelineId,
            aggregateId,
            inputType: 'ForcePaymentFailure',
            parameters: null,
            applied: true,
            createdAt: new Date().toISOString(),
          },
        ];
      },
    };

    const diffEngine = new TimelineDiffEngine(mockProvider);
    const diff = await diffEngine.diff({
      timelineIdA: mainTimelineId,
      timelineIdB: branchTimelineId,
      aggregateId,
    });

    expect(diff.commonAncestorTimelineId).toBe(mainTimelineId);
    expect(diff.forkPosition).toBe(1);
    expect(diff.hashesMatch).toBe(false);
    expect(diff.stateDiff.status).toEqual({ from: 'PAID', to: 'CANCELLED' });
    expect(diff.divergingEventsA).toHaveLength(1);
    expect(diff.divergingEventsA[0]!.event_id).toBe('m2');
    expect(diff.divergingEventsB).toHaveLength(1);
    expect(diff.divergingEventsB[0]!.event_id).toBe('b2');
    expect(diff.stateDiff.divergenceReason).toContain('ForcePaymentFailure');
  });
});
