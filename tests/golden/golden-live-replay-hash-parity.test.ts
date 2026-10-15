import { describe, expect, it } from 'vitest';
import {
  type DomainEvent,
  type OrderState,
  computeStateHash,
  decideCreateOrder,
  decideAddOrderItem,
  decideConfirmOrder,
  decideMarkOrderPaid,
  decideMarkOrderAllocated,
  decideMarkOrderShipped,
  orderReducer,
  decideAuthorizePayment,
  decideCapturePayment,
  paymentReducer,
  type PaymentState,
} from '@chronoscope/domain';
import {
  InMemoryAggregateRepository,
  InMemoryExecutionManager,
  InMemorySnapshotMetadataManager,
} from '@chronoscope/database';
import {
  AuthoritativeStateResolver,
  InMemoryEventReader,
  InMemorySnapshotStorage,
  SnapshotManager,
  LiveReplayService,
  type ILiveStateProvider,
} from '@chronoscope/replay-engine';

describe('Golden Scenario (North-Star #1): Live/Replay Hash Parity Proof (Rules 9, 11, 12, 14 & ADR-008, ADR-009)', () => {
  const TIMELINE_MAIN = '00000000-0000-0000-0000-000000000001';
  const orderId = 'ord-north-star-1';
  const paymentId = 'pay-north-star-1';

  it('runs complete fulfillment lifecycle, captures snapshots, proves non-circular live/replay hash parity, and handles corruption fallback', async () => {
    // -------------------------------------------------------------------------
    // Phase A: Live Execution (Command -> Domain Decide -> Append Tx -> aggregate_state)
    // -------------------------------------------------------------------------
    const orderRepo = new InMemoryAggregateRepository<OrderState>('Order');
    const paymentRepo = new InMemoryAggregateRepository<PaymentState>('Payment');

    // 1. OrderCreated (seq 1)
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
    await orderRepo.save(TIMELINE_MAIN, orderId, 0, [e1], s1, computeStateHash(s1));

    // 2. OrderItemAdded (seq 2)
    const e2 = decideAddOrderItem(
      {
        command_id: 'cmd-2',
        request_id: 'req-2',
        correlation_id: 'wf-1',
        causation_id: 'cmd-1',
        actor_id: 'alice',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 1,
        payload: {
          item: {
            sku: 'CHRONO-PRO-WATCH',
            quantity: 1,
            unitAmountMinor: 4999500n,
            totalAmountMinor: 4999500n,
          },
        },
      },
      s1,
      '2025-01-01T10:01:00.000Z',
    );
    const s2 = orderReducer(s1, e2);
    await orderRepo.save(TIMELINE_MAIN, orderId, 1, [e2], s2, computeStateHash(s2));

    // 3. OrderConfirmed (seq 3)
    const e3 = decideConfirmOrder(
      {
        command_id: 'cmd-3',
        request_id: 'req-3',
        correlation_id: 'wf-1',
        causation_id: 'cmd-2',
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
    await orderRepo.save(TIMELINE_MAIN, orderId, 2, [e3], s3, computeStateHash(s3));

    // 4. PaymentAuthorized (seq 1 on Payment aggregate)
    const ep1 = decideAuthorizePayment(
      {
        command_id: 'cmd-p1',
        request_id: 'req-p1',
        correlation_id: 'wf-1',
        causation_id: 'cmd-3',
        actor_id: 'alice',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: paymentId,
        aggregate_type: 'Payment',
        expected_sequence: 0,
        payload: {
          order_id: orderId,
          amount_minor: 4999500n,
          currency: 'INR',
          payment_method: 'UPI',
        },
      },
      null,
      '2025-01-01T10:03:00.000Z',
    );
    const sp1 = paymentReducer(null, ep1);
    await paymentRepo.save(TIMELINE_MAIN, paymentId, 0, [ep1], sp1, computeStateHash(sp1));

    // 5. PaymentCaptured (seq 2 on Payment aggregate)
    const ep2 = decideCapturePayment(
      {
        command_id: 'cmd-p2',
        request_id: 'req-p2',
        correlation_id: 'wf-1',
        causation_id: 'cmd-p1',
        actor_id: 'system',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: paymentId,
        aggregate_type: 'Payment',
        expected_sequence: 1,
        payload: { transaction_reference: 'TXN-UPI-999888' },
      },
      sp1,
      '2025-01-01T10:04:00.000Z',
    );
    const sp2 = paymentReducer(sp1, ep2);
    await paymentRepo.save(TIMELINE_MAIN, paymentId, 1, [ep2], sp2, computeStateHash(sp2));

    // 6. OrderPaid (seq 4 on Order)
    const e4 = decideMarkOrderPaid(
      {
        command_id: 'cmd-4',
        request_id: 'req-4',
        correlation_id: 'wf-1',
        causation_id: 'cmd-p2',
        actor_id: 'system',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 3,
        payload: {
          payment_id: paymentId,
          amount_minor: 4999500n,
          currency: 'INR',
        },
      },
      s3,
      '2025-01-01T10:05:00.000Z',
    );
    const s4 = orderReducer(s3, e4);
    await orderRepo.save(TIMELINE_MAIN, orderId, 3, [e4], s4, computeStateHash(s4));

    // 7. OrderAllocated (seq 5 on Order)
    const e5 = decideMarkOrderAllocated(
      {
        command_id: 'cmd-5',
        request_id: 'req-5',
        correlation_id: 'wf-1',
        causation_id: 'cmd-4',
        actor_id: 'system',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 4,
        payload: { allocation_id: 'alloc-1' },
      },
      s4,
      '2025-01-01T10:06:00.000Z',
    );
    const s5 = orderReducer(s4, e5);
    await orderRepo.save(TIMELINE_MAIN, orderId, 4, [e5], s5, computeStateHash(s5));

    // 8. OrderShipped (seq 6 on Order)
    const e6 = decideMarkOrderShipped(
      {
        command_id: 'cmd-6',
        request_id: 'req-6',
        correlation_id: 'wf-1',
        causation_id: 'cmd-5',
        actor_id: 'system',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 5,
        payload: { shipment_id: 'ship-1' },
      },
      s5,
      '2025-01-01T10:07:00.000Z',
    );
    const s6 = orderReducer(s5, e6);
    const liveOrderHashFinal = computeStateHash(s6);
    await orderRepo.save(TIMELINE_MAIN, orderId, 5, [e6], s6, liveOrderHashFinal);

    // Verify live state in repository
    const liveSnapshot = await orderRepo.load(TIMELINE_MAIN, orderId);
    expect(liveSnapshot).not.toBeNull();
    expect(liveSnapshot!.sequence).toBe(6);
    expect(liveSnapshot!.state.status).toBe('SHIPPED');
    expect(liveSnapshot!.stateHash).toBe(liveOrderHashFinal);

    // -------------------------------------------------------------------------
    // Phase B: Setup Replay Infrastructure (EventReader, SnapshotStorage, ReplayService)
    // -------------------------------------------------------------------------
    // Harvest raw domain events from repository
    const rawOrderEvents = orderRepo.getEvents(TIMELINE_MAIN, orderId).map(
      (se) =>
        ({
          event_id: se.eventId,
          timeline_id: se.timelineId,
          aggregate_id: se.aggregateId,
          aggregate_type: se.aggregateType,
          aggregate_sequence: se.aggregateSequence,
          event_type: se.eventType,
          schema_version: se.schemaVersion,
          payload: se.payload,
          event_hash: se.eventHash,
          causation_id: se.causationId,
          correlation_id: se.correlationId,
          recorded_at: se.recordedAt,
        }) as DomainEvent,
    );

    const eventReader = new InMemoryEventReader(rawOrderEvents);
    const executionManager = new InMemoryExecutionManager();
    const metadataManager = new InMemorySnapshotMetadataManager();
    const storage = new InMemorySnapshotStorage();
    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const snapshotManager = new SnapshotManager(metadataManager, storage, stateResolver);

    const liveStateProvider: ILiveStateProvider = {
      async getLiveState(tId: string, aId: string) {
        const snap = await orderRepo.load(tId, aId);
        if (!snap) return null;
        return {
          sequence: snap.sequence,
          state: snap.state,
          stateHash: snap.stateHash,
        };
      },
    };

    const replayService = new LiveReplayService(
      eventReader,
      executionManager,
      snapshotManager,
      liveStateProvider,
    );

    // -------------------------------------------------------------------------
    // Step 1: Genesis LIVE_REPLAY (without snapshots) -> Proves Exact Hash Parity
    // -------------------------------------------------------------------------
    const genesisResult = await replayService.replayAggregate<OrderState>({
      timelineId: TIMELINE_MAIN,
      aggregateId: orderId,
      aggregateType: 'Order',
      targetSequence: 6,
      useSnapshot: false,
    });

    expect(genesisResult.fromSequence).toBe(0);
    expect(genesisResult.toSequence).toBe(6);
    expect(genesisResult.eventsReplayed).toBe(6);
    expect(genesisResult.snapshotId).toBeNull();
    expect(genesisResult.state?.status).toBe('SHIPPED');

    // North-Star #1 Invariant: Independent replay hash matches live aggregate_state hash byte-for-byte!
    expect(genesisResult.stateHash).toBe(liveOrderHashFinal);
    expect(genesisResult.liveStateHash).toBe(liveOrderHashFinal);
    expect(genesisResult.hashParityMatched).toBe(true);

    // -------------------------------------------------------------------------
    // Step 2: Capture Snapshot at Sequence 3 (Confirmed Order)
    // -------------------------------------------------------------------------
    const snapSeq3 = await snapshotManager.createAggregateSnapshot({
      timelineId: TIMELINE_MAIN,
      aggregateId: orderId,
      targetSequence: 3,
      aggregateType: 'Order',
    });

    expect(snapSeq3.status).toBe('READY');
    expect(snapSeq3.aggregateSequence).toBe(3);
    expect(snapSeq3.contentHash).toBeDefined();

    // Verify storage payload state
    const snapPayload = await storage.readSnapshotPayload<{ state: OrderState }>(
      snapSeq3.storageLocation,
    );
    expect(snapPayload.state.status).toBe('CONFIRMED');

    // -------------------------------------------------------------------------
    // Step 3: Fast-Forward Replay via Snapshot -> Residual Events Replayed
    // -------------------------------------------------------------------------
    const acceleratedResult = await replayService.replayAggregate<OrderState>({
      timelineId: TIMELINE_MAIN,
      aggregateId: orderId,
      aggregateType: 'Order',
      targetSequence: 6,
      useSnapshot: true,
    });

    expect(acceleratedResult.fromSequence).toBe(3);
    expect(acceleratedResult.toSequence).toBe(6);
    expect(acceleratedResult.snapshotId).toBe(snapSeq3.snapshotId);
    expect(acceleratedResult.eventsReplayed).toBe(3); // only sequences 4, 5, 6 replayed
    expect(acceleratedResult.state?.status).toBe('SHIPPED');

    // Exact hash parity preserved when fast-forwarding through verified snapshot!
    expect(acceleratedResult.stateHash).toBe(liveOrderHashFinal);
    expect(acceleratedResult.liveStateHash).toBe(liveOrderHashFinal);
    expect(acceleratedResult.hashParityMatched).toBe(true);

    // -------------------------------------------------------------------------
    // Step 4: Transparent Recovery on Snapshot Corruption (ADR-009 & Rule 14)
    // -------------------------------------------------------------------------
    storage.corruptPayload(snapSeq3.storageLocation);

    const fallbackResult = await replayService.replayAggregate<OrderState>({
      timelineId: TIMELINE_MAIN,
      aggregateId: orderId,
      aggregateType: 'Order',
      targetSequence: 6,
      useSnapshot: true,
    });

    // Detected corrupted snapshot, transparently bypassed, replayed all 6 events from genesis
    expect(fallbackResult.fromSequence).toBe(0);
    expect(fallbackResult.snapshotId).toBeNull();
    expect(fallbackResult.eventsReplayed).toBe(6);
    expect(fallbackResult.stateHash).toBe(liveOrderHashFinal);
    expect(fallbackResult.hashParityMatched).toBe(true);

    // -------------------------------------------------------------------------
    // Step 5: Parity Discrepancy Detection Verification
    // -------------------------------------------------------------------------
    // Create tampered live provider returning mismatched live hash
    const tamperedLiveProvider: ILiveStateProvider = {
      async getLiveState() {
        return {
          sequence: 6,
          state: s6,
          stateHash: 'corrupted-live-hash-000000000000000000000000000000000000000000000000000',
        };
      },
    };

    const strictReplayService = new LiveReplayService(
      eventReader,
      executionManager,
      undefined,
      tamperedLiveProvider,
    );

    const tamperedResult = await strictReplayService.replayAggregate<OrderState>({
      timelineId: TIMELINE_MAIN,
      aggregateId: orderId,
      aggregateType: 'Order',
      targetSequence: 6,
      useSnapshot: false,
    });

    // Discrepancy cleanly reported
    expect(tamperedResult.hashParityMatched).toBe(false);
    expect(tamperedResult.stateHash).not.toBe(tamperedResult.liveStateHash);

    // Audit record in chronoscope_ops.executions confirms hashParityMatched === false
    const tamperedAudit = await executionManager.getExecution(tamperedResult.executionId);
    expect(tamperedAudit?.hashParityMatched).toBe(false);
  });
});
