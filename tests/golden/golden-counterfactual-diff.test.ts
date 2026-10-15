import { describe, expect, it } from 'vitest';
import {
  type OrderState,
  computeStateHash,
  decideCreateOrder,
  decideAddOrderItem,
  decideConfirmOrder,
  decideMarkOrderPaid,
  decideMarkOrderAllocated,
  decideMarkOrderShipped,
  decideCancelOrder,
  orderReducer,
} from '@chronoscope/domain';
import {
  InMemoryAggregateRepository,
  InMemoryExecutionManager,
  InMemoryScenarioInputManager,
} from '@chronoscope/database';
import {
  TimelineForkService,
  CounterfactualReplayService,
  TimelineDiffEngine,
} from '@chronoscope/replay-engine';

describe('Golden Scenario: Timeline DAG, Counterfactual Replay & Diff Engine (Phase 7, Rules 6, 9, 11, 12, 13)', () => {
  const TIMELINE_MAIN = '00000000-0000-0000-0000-000000000001';
  const TIMELINE_BRANCH_CF = 'timeline-counterfactual-fail';
  const TIMELINE_BRANCH_SIBLING = 'timeline-sibling-normal';
  const TIMELINE_BRANCH_NESTED = 'timeline-nested-branch';
  const orderId = 'ord-counterfactual-golden-1';

  it('runs complete lifecycle on MAIN, forks zero-copy branch, executes counterfactual payment failure, proves hash parity, diffs divergence, and resolves nested hierarchy', async () => {
    // -------------------------------------------------------------------------
    // Phase A: Mainline Progression on MAIN (Sequence 0 -> 3)
    // -------------------------------------------------------------------------
    const orderRepo = new InMemoryAggregateRepository<OrderState>('Order');
    const scenarioManager = new InMemoryScenarioInputManager();
    const executionManager = new InMemoryExecutionManager();

    // 1. OrderCreated (seq 1, pos 1)
    const e1 = decideCreateOrder(
      {
        command_id: 'cmd-1',
        request_id: 'req-1',
        correlation_id: 'wf-1',
        causation_id: null,
        actor_id: 'alice',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 0,
        payload: { customer_id: 'alice', currency: 'INR' },
      },
      null,
      '2025-01-01T10:00:00.000Z',
    );
    const s1 = orderReducer(null, e1);
    const h1 = computeStateHash(s1);
    await orderRepo.save(TIMELINE_MAIN, orderId, 0, [e1], s1, h1);

    // 2. OrderItemAdded (seq 2, pos 2) - Laptop (50,000 INR)
    const e2 = decideAddOrderItem(
      {
        command_id: 'cmd-2',
        request_id: 'req-2',
        correlation_id: 'wf-1',
        causation_id: e1.event_id,
        actor_id: 'alice',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 1,
        payload: {
          item: {
            sku: 'SKU-LAPTOP-PRO',
            quantity: 1,
            unitAmountMinor: 50000n,
            totalAmountMinor: 50000n,
          },
        },
      },
      s1,
      '2025-01-01T10:01:00.000Z',
    );

    const s2 = orderReducer(s1, e2);
    const h2 = computeStateHash(s2);
    await orderRepo.save(TIMELINE_MAIN, orderId, 1, [e2], s2, h2);

    // 3. OrderConfirmed (seq 3, pos 3)
    const e3 = decideConfirmOrder(
      {
        command_id: 'cmd-3',
        request_id: 'req-3',
        correlation_id: 'wf-1',
        causation_id: e2.event_id,
        actor_id: 'alice',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 2,
        payload: {},
      },
      s2,
      '2025-01-01T10:02:00.000Z',
    );
    const s3 = orderReducer(s2, e3);
    const h3 = computeStateHash(s3);
    await orderRepo.save(TIMELINE_MAIN, orderId, 2, [e3], s3, h3);

    const headPosMain = orderRepo.getHeadPosition(TIMELINE_MAIN);
    expect(headPosMain).toBe(3);

    // -------------------------------------------------------------------------
    // Phase B: Zero-Copy Timeline Fork (Rules 6 & 13, ADR-010)
    // -------------------------------------------------------------------------
    const forkService = new TimelineForkService({
      async createTimeline(params) {
        return orderRepo.createTimeline(params as never) as never;
      },
      async getTimeline(timelineId) {
        return orderRepo.getTimeline(timelineId) as never;
      },
      async getAncestry(timelineId) {
        return orderRepo.getAncestry(timelineId);
      },
    });

    // Fork branch at position 3 (current head of MAIN)
    const branchRecord = await forkService.fork({
      parentTimelineId: TIMELINE_MAIN,
      forkPosition: 3,
      timelineId: TIMELINE_BRANCH_CF,
      name: 'Counterfactual: Payment Failure',
      description: 'Simulates what happens if payment authorization fails for order',
    });
    expect(branchRecord.forkPosition).toBe(3);
    expect(branchRecord.parentTimelineId).toBe(TIMELINE_MAIN);

    // Fork sibling branch at position 3
    await forkService.fork({
      parentTimelineId: TIMELINE_MAIN,
      forkPosition: 3,
      timelineId: TIMELINE_BRANCH_SIBLING,
      name: 'Sibling Branch',
    });

    // -------------------------------------------------------------------------
    // Phase C: Mainline Continues & Counterfactual Divergence on Branch
    // -------------------------------------------------------------------------
    // On MAIN: Payment succeeded -> OrderPaid (seq 4, pos 4) -> OrderShipped (seq 5, pos 5)
    const e4 = decideMarkOrderPaid(
      {
        command_id: 'cmd-4',
        request_id: 'req-4',
        correlation_id: 'wf-1',
        causation_id: e3.event_id,
        actor_id: 'system',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 3,
        payload: { payment_id: 'pay-main-1', amount_minor: 50000n, currency: 'INR' },
      },
      s3,
      '2025-01-01T10:05:00.000Z',
    );
    const s4 = orderReducer(s3, e4);
    const h4 = computeStateHash(s4);
    await orderRepo.save(TIMELINE_MAIN, orderId, 3, [e4], s4, h4);

    const eAlloc = decideMarkOrderAllocated(
      {
        command_id: 'cmd-alloc',
        request_id: 'req-alloc',
        correlation_id: 'wf-1',
        causation_id: e4.event_id,
        actor_id: 'system',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 4,
        payload: { allocation_id: 'alloc-main-1' },
      },
      s4,
      '2025-01-01T10:08:00.000Z',
    );
    const sAlloc = orderReducer(s4, eAlloc);
    const hAlloc = computeStateHash(sAlloc);
    await orderRepo.save(TIMELINE_MAIN, orderId, 4, [eAlloc], sAlloc, hAlloc);

    const e5 = decideMarkOrderShipped(
      {
        command_id: 'cmd-5',
        request_id: 'req-5',
        correlation_id: 'wf-1',
        causation_id: eAlloc.event_id,
        actor_id: 'system',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 5,
        payload: { shipment_id: 'ship-main-1' },
      },
      sAlloc,
      '2025-01-01T10:10:00.000Z',
    );
    const s5 = orderReducer(sAlloc, e5);
    const h5 = computeStateHash(s5);
    await orderRepo.save(TIMELINE_MAIN, orderId, 5, [e5], s5, h5);

    expect(s5.status).toBe('SHIPPED');
    expect(orderRepo.getHeadPosition(TIMELINE_MAIN)).toBe(6);

    // On BRANCH: Persist ScenarioInput: ForcePaymentFailure (Rule 12 & 27)
    await scenarioManager.recordInput({
      timelineId: TIMELINE_BRANCH_CF,
      aggregateId: orderId,
      inputType: 'ForcePaymentFailure',
      parameters: { reason: 'CARD_DECLINED_SIMULATED' },
    });

    // Materialize branch aggregate at sequence 0 with inherited state s3 (Rule 13)
    orderRepo.materializeBranchAggregate(TIMELINE_BRANCH_CF, orderId, s3, h3);

    const branchSnapshotInit = await orderRepo.load(TIMELINE_BRANCH_CF, orderId);
    expect(branchSnapshotInit).not.toBeNull();
    expect(branchSnapshotInit!.sequence).toBe(0); // Branch-local sequence starts at 0!
    expect(branchSnapshotInit!.state.status).toBe('CONFIRMED');
    expect(branchSnapshotInit!.state.items).toHaveLength(1);
    expect(branchSnapshotInit!.state.total_amount_minor).toBe(50000n);

    // In response to payment failure, Order is Cancelled (Compensation)
    const eBranchCancel = decideCancelOrder(
      {
        command_id: 'cmd-cf-cancel',
        request_id: 'req-cf-1',
        correlation_id: 'wf-cf-1',
        causation_id: e3.event_id,
        actor_id: 'saga-orchestrator',
        timeline_id: TIMELINE_BRANCH_CF,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 0,
        payload: { reason: 'PAYMENT_FAILED: CARD_DECLINED_SIMULATED' },
      },
      s3,
      '2025-01-01T10:06:00.000Z',
    );

    const sBranchFinal = orderReducer(s3, eBranchCancel);
    const hBranchFinal = computeStateHash(sBranchFinal);

    // Append branch-local event: expected_sequence = 0, newSequence = 1 (Rule 13)
    const branchAppend = await orderRepo.save(
      TIMELINE_BRANCH_CF,
      orderId,
      0,
      [eBranchCancel],
      sBranchFinal,
      hBranchFinal,
    );

    expect(branchAppend.success).toBe(true);
    expect(branchAppend.newSequence).toBe(1);

    // Confirm Three-Way Invariant on Branch using branch-local rows (Rule 9 & 13)
    const branchSnapshotFinal = await orderRepo.load(TIMELINE_BRANCH_CF, orderId);
    expect(branchSnapshotFinal!.sequence).toBe(1);
    expect(branchSnapshotFinal!.state.status).toBe('CANCELLED');
    expect(branchSnapshotFinal!.stateHash).toBe(hBranchFinal);

    // Sibling Isolation Proof (Rule 13):
    // BRANCH-SIBLING sees MAIN up to pos 3, but zero events from BRANCH-COUNTERFACTUAL
    const effectiveSibling = orderRepo.getEffectiveEvents(TIMELINE_BRANCH_SIBLING, orderId);
    const siblingEventIds = effectiveSibling.map((e) => e.eventId);
    expect(siblingEventIds).toEqual([e1.event_id, e2.event_id, e3.event_id]);
    expect(siblingEventIds).not.toContain(e4.event_id);
    expect(siblingEventIds).not.toContain(e5.event_id);
    expect(siblingEventIds).not.toContain(eBranchCancel.event_id);

    // -------------------------------------------------------------------------
    // Phase D: Deterministic COUNTERFACTUAL_REPLAY Proof (Rules 9, 11, 12)
    // -------------------------------------------------------------------------
    const effectiveBranchEvents = orderRepo.getEffectiveEvents(TIMELINE_BRANCH_CF, orderId);
    expect(effectiveBranchEvents).toHaveLength(4); // e1, e2, e3 from MAIN + eBranchCancel from branch

    const eventReader = {
      async loadEventsForAggregate(tId: string, aggId: string) {
        const events = orderRepo.getEffectiveEvents(tId, aggId);
        return events.map((e) => ({
          event_id: e.eventId,
          timeline_id: e.timelineId,
          timeline_position: e.timelinePosition,
          aggregate_id: e.aggregateId,
          aggregate_type: e.aggregateType,
          aggregate_sequence: e.aggregateSequence,
          event_type: e.eventType,
          schema_version: e.schemaVersion,
          payload: e.payload,
          event_hash: e.eventHash,
          causation_id: e.causationId,
          correlation_id: e.correlationId,
          command_id: null,
          recorded_at: e.recordedAt,
        })) as never;
      },
    };

    const liveStateProvider = {
      async getLiveState(timelineId: string, aggId: string) {
        const snap = await orderRepo.load(timelineId, aggId);
        if (!snap) return null;
        return {
          sequence: snap.sequence,
          state: snap.state,
          stateHash: snap.stateHash,
        };
      },
    };

    const counterfactualService = new CounterfactualReplayService(
      eventReader,
      executionManager,
      scenarioManager,
      liveStateProvider,
    );

    const replayResult = await counterfactualService.replayAggregate({
      timelineId: TIMELINE_BRANCH_CF,
      aggregateId: orderId,
      aggregateType: 'Order',
    });

    // Proves non-circular hash parity against branch's live aggregate_state.state_hash!
    expect(replayResult.hashParityMatched).toBe(true);
    expect(replayResult.stateHash).toBe(hBranchFinal);
    expect(replayResult.eventsReplayed).toBe(4);

    // Confirms audit logged in chronoscope_ops.executions
    const executionAudit = await executionManager.getExecution(replayResult.executionId);
    expect(executionAudit).not.toBeNull();
    expect(executionAudit!.mode).toBe('COUNTERFACTUAL_REPLAY');
    expect(executionAudit!.status).toBe('COMPLETED');
    expect(executionAudit!.hashParityMatched).toBe(true);

    // -------------------------------------------------------------------------
    // Phase E: Timeline Diff Engine (MAIN vs BRANCH-COUNTERFACTUAL)
    // -------------------------------------------------------------------------
    const diffEngine = new TimelineDiffEngine({
      async getState(tId: string, aggId: string) {
        const snap = await orderRepo.load(tId, aggId);
        if (!snap) return null;
        return { state: snap.state, stateHash: snap.stateHash };
      },
      async getAncestry(tId: string) {
        return orderRepo.getAncestry(tId);
      },
      async getEffectiveEvents(tId: string, aggId?: string) {
        return orderRepo.getEffectiveEvents(tId, aggId) as never;
      },
      async getScenarioInputs(tId: string) {
        return scenarioManager.getInputsByTimeline(tId);
      },
    });

    const diff = await diffEngine.diff({
      timelineIdA: TIMELINE_MAIN,
      timelineIdB: TIMELINE_BRANCH_CF,
      aggregateId: orderId,
    });

    expect(diff.commonAncestorTimelineId).toBe(TIMELINE_MAIN);
    expect(diff.forkPosition).toBe(3);
    expect(diff.hashesMatch).toBe(false);
    expect(diff.stateDiff.status).toEqual({ from: 'SHIPPED', to: 'CANCELLED' });
    expect(diff.divergingEventsA).toHaveLength(3); // e4 (OrderPaid), eAlloc (OrderAllocated), e5 (OrderShipped)
    expect(diff.divergingEventsB).toHaveLength(1); // eBranchCancel
    expect(diff.stateDiff.divergenceReason).toContain('ForcePaymentFailure');

    // -------------------------------------------------------------------------
    // Phase F: Nested Branching (MAIN -> BRANCH_CF -> BRANCH_NESTED)
    // -------------------------------------------------------------------------
    const headPosBranch = orderRepo.getHeadPosition(TIMELINE_BRANCH_CF);
    expect(headPosBranch).toBe(7);

    await forkService.fork({
      parentTimelineId: TIMELINE_BRANCH_CF,
      forkPosition: headPosBranch,
      timelineId: TIMELINE_BRANCH_NESTED,
      name: 'Nested Branch',
    });

    // Effective history on nested branch recursively includes:
    // MAIN (<= 3) + BRANCH_CF (<= 6)
    const effectiveNested = orderRepo.getEffectiveEvents(TIMELINE_BRANCH_NESTED, orderId);
    expect(effectiveNested).toHaveLength(4);
    expect(effectiveNested.map((e) => e.eventId)).toEqual([
      e1.event_id,
      e2.event_id,
      e3.event_id,
      eBranchCancel.event_id,
    ]);
  });
});
