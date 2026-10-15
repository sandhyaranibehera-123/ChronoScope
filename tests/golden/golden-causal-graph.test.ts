import { describe, expect, it } from 'vitest';
import {
  computeStateHash,
  decideCreateOrder,
  decideAddOrderItem,
  decideConfirmOrder,
  decideCancelOrder,
  decideAuthorizePayment,
  decideFailPayment,
  orderReducer,
  paymentReducer,
  type DomainEvent,
} from '@chronoscope/domain';
import { InMemoryAggregateRepository } from '@chronoscope/database';
import { CausalGraphEngine, type CausalEventProvider } from '@chronoscope/replay-engine';

describe('Golden Scenario: Causal Graph & Cycle-Safe Traversal (Phase 8, Rules 5, 12, 24)', () => {
  const TIMELINE_MAIN = '00000000-0000-0000-0000-000000000001';
  const TIMELINE_BRANCH_CF = 'timeline-counterfactual-causal';
  const orderId = 'ord-causal-golden-1';
  const paymentId = 'pay-causal-golden-1';
  const correlationId = 'wf-saga-fulfillment-causal-1';

  it('proves typed causal edges (CausationEdge, TimelineAncestryEdge, WorkflowEdge), automated root cause diagnosis, blast radius, and cycle safety', async () => {
    // -------------------------------------------------------------------------
    // Phase A: Execute Multi-Aggregate Saga with Timeline Fork & Compensation
    // -------------------------------------------------------------------------
    // Use a single eventStore repository so timeline_position is globally monotonic (Rule 5 & 6)
    const eventStore = new InMemoryAggregateRepository<unknown>('Domain');

    // Step 1: OrderCreated on MAIN (seq 1, pos 1, causationId null)
    const eOrderCreated = decideCreateOrder(
      {
        command_id: 'cmd-create-1',
        request_id: 'req-1',
        correlation_id: correlationId,
        causation_id: null,
        actor_id: 'buyer',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 0,
        payload: { customer_id: 'buyer', currency: 'INR' },
      },
      null,
      '2026-10-13T10:00:00.000Z',
    );
    const s1 = orderReducer(null, eOrderCreated);
    const h1 = computeStateHash(s1);
    await eventStore.save(TIMELINE_MAIN, orderId, 0, [eOrderCreated], s1, h1);

    // Step 1b: AddOrderItem on MAIN (seq 2, pos 2, causationId eOrderCreated)
    const eItemAdded = decideAddOrderItem(
      {
        command_id: 'cmd-item-1',
        request_id: 'req-item-1',
        correlation_id: correlationId,
        causation_id: eOrderCreated.event_id,
        actor_id: 'buyer',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 1,
        payload: {
          item: {
            sku: 'SKU-TEST-1',
            quantity: 1,
            unitAmountMinor: 49995n,
            totalAmountMinor: 49995n,
          },
        },
      },
      s1,
      '2026-10-13T10:00:30.000Z',
    );
    const sItem = orderReducer(s1, eItemAdded);
    const hItem = computeStateHash(sItem);
    await eventStore.save(TIMELINE_MAIN, orderId, 1, [eItemAdded], sItem, hItem);

    // Step 2: OrderConfirmed on MAIN (seq 3, pos 3, causationId eItemAdded)
    const eOrderConfirmed = decideConfirmOrder(
      {
        command_id: 'cmd-confirm-1',
        request_id: 'req-2',
        correlation_id: correlationId,
        causation_id: eItemAdded.event_id,
        actor_id: 'buyer',
        timeline_id: TIMELINE_MAIN,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 2,
        payload: {},
      },
      sItem,
      '2026-10-13T10:01:00.000Z',
    );
    const s2 = orderReducer(sItem, eOrderConfirmed);
    const h2 = computeStateHash(s2);
    await eventStore.save(TIMELINE_MAIN, orderId, 2, [eOrderConfirmed], s2, h2);

    // Step 3: Fork timeline at position 3 to explore counterfactual failure
    eventStore.createTimeline({
      timelineId: TIMELINE_BRANCH_CF,
      parentTimelineId: TIMELINE_MAIN,
      forkPosition: 3,
      name: 'Counterfactual Payment Failure Branch',
    });

    // Step 4: On branch, PaymentAuthorized (Payment aggregate, seq 1, pos 4, causationId eOrderConfirmed)
    const ePaymentAuth = decideAuthorizePayment(
      {
        command_id: 'cmd-auth-1',
        request_id: 'req-3',
        correlation_id: correlationId,
        causation_id: eOrderConfirmed.event_id,
        actor_id: 'buyer',
        timeline_id: TIMELINE_BRANCH_CF,
        aggregate_id: paymentId,
        aggregate_type: 'Payment',
        expected_sequence: 0,
        payload: {
          order_id: orderId,
          amount_minor: 49995n,
          currency: 'INR',
          payment_method: 'CARD',
        },
      },
      null,
      '2026-10-13T10:02:00.000Z',
    );
    const sPay1 = paymentReducer(null, ePaymentAuth);
    const hPay1 = computeStateHash(sPay1);
    await eventStore.save(TIMELINE_BRANCH_CF, paymentId, 0, [ePaymentAuth], sPay1, hPay1);

    // Step 5: Counterfactual failure induces PaymentFailed (seq 2, pos 5, causationId ePaymentAuth)
    const ePaymentFailed = decideFailPayment(
      {
        command_id: 'cmd-fail-1',
        request_id: 'req-4',
        correlation_id: correlationId,
        causation_id: ePaymentAuth.event_id,
        actor_id: 'system',
        timeline_id: TIMELINE_BRANCH_CF,
        aggregate_id: paymentId,
        aggregate_type: 'Payment',
        expected_sequence: 1,
        payload: { failure_reason: 'ForcePaymentFailure simulation' },
      },
      sPay1,
      '2026-10-13T10:03:00.000Z',
    );
    const sPay2 = paymentReducer(sPay1, ePaymentFailed);
    const hPay2 = computeStateHash(sPay2);
    await eventStore.save(TIMELINE_BRANCH_CF, paymentId, 1, [ePaymentFailed], sPay2, hPay2);

    // Step 6: Saga backward compensation triggers OrderCancelled on branch (seq 1 on branch local, pos 6, causationId ePaymentFailed)
    eventStore.materializeBranchAggregate(TIMELINE_BRANCH_CF, orderId, s2, h2);
    const eOrderCancelled = decideCancelOrder(
      {
        command_id: 'cmd-cancel-1',
        request_id: 'req-5',
        correlation_id: correlationId,
        causation_id: ePaymentFailed.event_id,
        actor_id: 'orchestrator',
        timeline_id: TIMELINE_BRANCH_CF,
        aggregate_id: orderId,
        aggregate_type: 'Order',
        expected_sequence: 0,
        payload: { reason: 'Compensation: Payment failure' },
      },
      s2,
      '2026-10-13T10:04:00.000Z',
    );
    const s3Branch = orderReducer(s2, eOrderCancelled);
    const h3Branch = computeStateHash(s3Branch);
    await eventStore.save(TIMELINE_BRANCH_CF, orderId, 0, [eOrderCancelled], s3Branch, h3Branch);

    // Aggregate all events across repos into a unified causal provider
    const allEvents: DomainEvent[] = eventStore.getAllEvents();

    const provider: CausalEventProvider = {
      getEventById(id: string) {
        return allEvents.find((e) => (e.event_id || e.eventId) === id) || null;
      },
      getEventsByCorrelationId(corrId: string) {
        return allEvents.filter((e) => (e.correlation_id || e.correlationId) === corrId);
      },
      getEventsByTimelineId(timelineId: string) {
        return allEvents.filter((e) => (e.timeline_id || e.timelineId) === timelineId);
      },
      getEventsByCausationId(causationId: string) {
        return allEvents.filter((e) => (e.causation_id || e.causationId) === causationId);
      },
      getAncestry(timelineId: string) {
        return eventStore.getAncestry(timelineId);
      },
      getAllEvents() {
        return allEvents;
      },
    };

    const engine = new CausalGraphEngine(provider);

    // -------------------------------------------------------------------------
    // Assertion 1: Upstream Root-Cause Analysis (OrderCancelled -> Genesis)
    // -------------------------------------------------------------------------
    const upstreamGraph = await engine.traceUpstream(eOrderCancelled.event_id);

    expect(upstreamGraph.cycleDetected).toBe(false);
    expect(upstreamGraph.rootEventIds).toEqual([eOrderCreated.event_id]);
    expect(Object.keys(upstreamGraph.nodes)).toHaveLength(6);

    // Verify all CausationEdge links
    expect(upstreamGraph.edges.every((e) => e.type === 'CAUSATION')).toBe(true);

    const explanation = await engine.explainRootCause(eOrderCancelled.event_id);
    expect(explanation.targetEventId).toBe(eOrderCancelled.event_id);
    expect(explanation.targetEventType).toBe('OrderCancelled');
    expect(explanation.rootEventId).toBe(eOrderCreated.event_id);
    expect(explanation.rootEventType).toBe('OrderCreated');
    expect(explanation.immediateCause).toEqual({
      eventId: ePaymentFailed.event_id,
      eventType: 'PaymentFailed',
    });
    expect(explanation.causalChain.map((s) => s.eventType)).toEqual([
      'OrderCreated',
      'OrderItemAdded',
      'OrderConfirmed',
      'PaymentAuthorized',
      'PaymentFailed',
      'OrderCancelled',
    ]);
    expect(explanation.narrative).toContain('OrderCancelled');
    expect(explanation.narrative).toContain('PaymentFailed');
    expect(explanation.narrative).toContain('OrderCreated');

    // -------------------------------------------------------------------------
    // Assertion 2: Downstream Blast-Radius Analysis (OrderConfirmed -> Consequences)
    // -------------------------------------------------------------------------
    const blastRadius = await engine.traceDownstream(eOrderConfirmed.event_id);

    expect(blastRadius.cycleDetected).toBe(false);
    expect(blastRadius.rootEventIds).toEqual([eOrderConfirmed.event_id]);
    expect(blastRadius.nodes[ePaymentAuth.event_id]).toBeDefined();
    expect(blastRadius.nodes[ePaymentFailed.event_id]).toBeDefined();
    expect(blastRadius.nodes[eOrderCancelled.event_id]).toBeDefined();
    // Genesis event OrderCreated is NOT in the blast radius of OrderConfirmed
    expect(blastRadius.nodes[eOrderCreated.event_id]).toBeUndefined();

    // -------------------------------------------------------------------------
    // Assertion 3: Multi-Aggregate Workflow DAG (CausationEdge + WorkflowEdge)
    // -------------------------------------------------------------------------
    const workflowGraph = await engine.buildWorkflowGraph(correlationId);

    expect(workflowGraph.metrics.totalNodes).toBe(6);
    expect(workflowGraph.metrics.causationEdges).toBe(5);
    expect(workflowGraph.metrics.workflowEdges).toBeGreaterThan(0);

    const causationEdges = workflowGraph.edges.filter((e) => e.type === 'CAUSATION');
    const workflowEdges = workflowGraph.edges.filter((e) => e.type === 'WORKFLOW');

    expect(causationEdges.length).toBe(5);
    expect(workflowEdges.length).toBeGreaterThan(0);

    // -------------------------------------------------------------------------
    // Assertion 4: Timeline Graph with TimelineAncestryEdge Across Fork Point
    // -------------------------------------------------------------------------
    const branchTimelineGraph = await engine.buildTimelineGraph(TIMELINE_BRANCH_CF);

    const ancestryEdge = branchTimelineGraph.edges.find((e) => e.type === 'TIMELINE_ANCESTRY');
    expect(ancestryEdge).toBeDefined();
    expect(ancestryEdge!.source).toBe(eOrderConfirmed.event_id); // parent event at fork position
    expect(ancestryEdge!.target).toBe(ePaymentAuth.event_id); // first branch event

    // -------------------------------------------------------------------------
    // Assertion 5: Rule 24 Cycle Safety Guard Verification
    // -------------------------------------------------------------------------
    const corruptedCyclicEvents: DomainEvent[] = [
      {
        eventId: 'corrupt-1',
        timelineId: TIMELINE_MAIN,
        timelinePosition: 10,
        aggregateId: 'bad-agg',
        aggregateType: 'Order',
        aggregateSequence: 1,
        eventType: 'CorruptA',
        schemaVersion: 1,
        payload: {},
        eventHash: 'hA',
        causationId: 'corrupt-2', // Points to 2
        correlationId: 'wf-loop',
        recordedAt: '2026-10-13T11:00:00Z',
      },
      {
        eventId: 'corrupt-2',
        timelineId: TIMELINE_MAIN,
        timelinePosition: 11,
        aggregateId: 'bad-agg',
        aggregateType: 'Order',
        aggregateSequence: 2,
        eventType: 'CorruptB',
        schemaVersion: 1,
        payload: {},
        eventHash: 'hB',
        causationId: 'corrupt-1', // Points back to 1! Cyclic!
        correlationId: 'wf-loop',
        recordedAt: '2026-10-13T11:01:00Z',
      },
    ];

    const cyclicProvider: CausalEventProvider = {
      getEventById(id: string) {
        return corruptedCyclicEvents.find((e) => (e.event_id || e.eventId) === id) || null;
      },
      getEventsByCorrelationId() {
        return corruptedCyclicEvents;
      },
    };

    const cyclicEngine = new CausalGraphEngine(cyclicProvider);
    const cyclicGraph = await cyclicEngine.traceUpstream('corrupt-2');

    expect(cyclicGraph.cycleDetected).toBe(true);
    expect(cyclicGraph.cycles).toBeDefined();
    expect(cyclicGraph.cycles!.length).toBeGreaterThan(0);

    // -------------------------------------------------------------------------
    // Assertion 6: Visual Exporters (ASCII, DOT, Mermaid) Syntax Verification
    // -------------------------------------------------------------------------
    const ascii = engine.renderAscii(workflowGraph);
    expect(ascii).toContain('Causal Graph: 6 nodes');

    expect(ascii).toContain('OrderCreated');
    expect(ascii).toContain('PaymentAuthorized');
    expect(ascii).toContain('OrderCancelled');
    expect(ascii).not.toContain('WARNING: CYCLE DETECTED');

    const dot = engine.renderDot(workflowGraph);
    expect(dot).toContain('digraph ChronoscopeCausalGraph');
    expect(dot).toContain('label="causation"');
    expect(dot).toContain('label="workflow"');

    const mermaid = engine.renderMermaid(workflowGraph);
    expect(mermaid).toContain('flowchart LR');
    expect(mermaid).toContain('==>|causation|');
  });
});
