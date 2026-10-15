import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@chronoscope/domain';
import { CausalGraphEngine, type CausalEventProvider } from '../index.js';

describe('Replay Engine — Causal Graph & Cycle-Safe Traversal (Phase 8, Rules 5, 12, 24)', () => {
  it('traces upstream causality and identifies genesis root event', async () => {
    const events: DomainEvent[] = [
      {
        event_id: 'ev-1',
        timeline_id: 'MAIN',
        timeline_position: 1,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'OrderCreated',
        schema_version: 1,
        payload: { customerId: 'cust-1' },
        event_hash: 'hash1',
        causation_id: null,
        correlation_id: 'wf-1',
        recorded_at: '2026-10-13T10:00:00Z',
      },
      {
        event_id: 'ev-2',
        timeline_id: 'MAIN',
        timeline_position: 2,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderConfirmed',
        schema_version: 1,
        payload: { amountMinor: 50000 },
        event_hash: 'hash2',
        causation_id: 'ev-1',
        correlation_id: 'wf-1',
        recorded_at: '2026-10-13T10:01:00Z',
      },
      {
        event_id: 'ev-3',
        timeline_id: 'MAIN',
        timeline_position: 3,
        aggregate_id: 'payment-1',
        aggregate_type: 'Payment',
        aggregate_sequence: 1,
        event_type: 'PaymentAuthorized',
        schema_version: 1,
        payload: { amountMinor: 50000 },
        event_hash: 'hash3',
        causation_id: 'ev-2',
        correlation_id: 'wf-1',
        recorded_at: '2026-10-13T10:02:00Z',
      },
    ];

    const provider: CausalEventProvider = {
      getEventById(id: string) {
        return events.find((e) => e.event_id === id) || null;
      },
      getEventsByCorrelationId(corrId: string) {
        return events.filter((e) => e.correlation_id === corrId);
      },
    };

    const engine = new CausalGraphEngine(provider);
    const graph = await engine.traceUpstream('ev-3');

    expect(graph.cycleDetected).toBe(false);
    expect(graph.rootEventIds).toEqual(['ev-1']);
    expect(Object.keys(graph.nodes)).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);

    expect(graph.edges[0]).toMatchObject({
      type: 'CAUSATION',
      source: 'ev-2',
      target: 'ev-3',
    });
    expect(graph.edges[1]).toMatchObject({
      type: 'CAUSATION',
      source: 'ev-1',
      target: 'ev-2',
    });

    // Verify explanation
    const explanation = await engine.explainRootCause('ev-3');
    expect(explanation.targetEventId).toBe('ev-3');
    expect(explanation.rootEventId).toBe('ev-1');
    expect(explanation.immediateCause).toEqual({
      eventId: 'ev-2',
      eventType: 'OrderConfirmed',
    });
    expect(explanation.causalChain).toHaveLength(3);
    expect(explanation.causalChain.map((s) => s.eventType)).toEqual([
      'OrderCreated',
      'OrderConfirmed',
      'PaymentAuthorized',
    ]);
  });

  it('traces downstream blast radius of an event', async () => {
    const events: DomainEvent[] = [
      {
        event_id: 'ev-root',
        timeline_id: 'MAIN',
        timeline_position: 1,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'OrderCreated',
        schema_version: 1,
        payload: {},
        event_hash: 'h1',
        causation_id: null,
        correlation_id: 'wf-1',
        recorded_at: '2026-10-13T10:00:00Z',
      },
      {
        event_id: 'ev-child-1',
        timeline_id: 'MAIN',
        timeline_position: 2,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderConfirmed',
        schema_version: 1,
        payload: {},
        event_hash: 'h2',
        causation_id: 'ev-root',
        correlation_id: 'wf-1',
        recorded_at: '2026-10-13T10:01:00Z',
      },
      {
        event_id: 'ev-child-2',
        timeline_id: 'MAIN',
        timeline_position: 3,
        aggregate_id: 'inventory-1',
        aggregate_type: 'Inventory',
        aggregate_sequence: 1,
        event_type: 'InventoryReserved',
        schema_version: 1,
        payload: {},
        event_hash: 'h3',
        causation_id: 'ev-child-1',
        correlation_id: 'wf-1',
        recorded_at: '2026-10-13T10:02:00Z',
      },
    ];

    const provider: CausalEventProvider = {
      getEventById(id: string) {
        return events.find((e) => e.event_id === id) || null;
      },
      getEventsByCorrelationId(corrId: string) {
        return events.filter((e) => e.correlation_id === corrId);
      },
      getEventsByCausationId(causationId: string) {
        return events.filter((e) => e.causation_id === causationId);
      },
    };

    const engine = new CausalGraphEngine(provider);
    const downstream = await engine.traceDownstream('ev-root');

    expect(downstream.cycleDetected).toBe(false);
    expect(Object.keys(downstream.nodes)).toHaveLength(3);
    expect(downstream.edges).toHaveLength(2);
    expect(downstream.nodes['ev-child-2']).toBeDefined();
  });

  it('safely detects cycles without infinite recursion or stack overflow (Rule 24 Cycle Safety)', async () => {
    // Malicious or corrupt cyclical graph: A -> B -> C -> A
    const cyclicEvents: DomainEvent[] = [
      {
        event_id: 'cycle-A',
        timeline_id: 'MAIN',
        timeline_position: 1,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'EventA',
        schema_version: 1,
        payload: {},
        event_hash: 'hA',
        causation_id: 'cycle-C', // points back to C!
        correlation_id: 'wf-cycle',
        recorded_at: '2026-10-13T10:00:00Z',
      },
      {
        event_id: 'cycle-B',
        timeline_id: 'MAIN',
        timeline_position: 2,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'EventB',
        schema_version: 1,
        payload: {},
        event_hash: 'hB',
        causation_id: 'cycle-A',
        correlation_id: 'wf-cycle',
        recorded_at: '2026-10-13T10:01:00Z',
      },
      {
        event_id: 'cycle-C',
        timeline_id: 'MAIN',
        timeline_position: 3,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 3,
        event_type: 'EventC',
        schema_version: 1,
        payload: {},
        event_hash: 'hC',
        causation_id: 'cycle-B',
        correlation_id: 'wf-cycle',
        recorded_at: '2026-10-13T10:02:00Z',
      },
    ];

    const provider: CausalEventProvider = {
      getEventById(id: string) {
        return cyclicEvents.find((e) => e.event_id === id) || null;
      },
      getEventsByCorrelationId() {
        return cyclicEvents;
      },
    };

    const engine = new CausalGraphEngine(provider);
    const graph = await engine.traceUpstream('cycle-C');

    // Cycle must be flagged and recursion terminated cleanly
    expect(graph.cycleDetected).toBe(true);
    expect(graph.cycles).toBeDefined();
    expect(graph.cycles!.length).toBeGreaterThan(0);

    // ASCII render displays cycle warning banner
    const ascii = engine.renderAscii(graph);
    expect(ascii).toContain('WARNING: CYCLE DETECTED');
  });

  it('constructs multi-aggregate workflow DAGs with CausationEdge and WorkflowEdge', async () => {
    const sagaEvents: DomainEvent[] = [
      {
        event_id: 'ev-order-created',
        timeline_id: 'MAIN',
        timeline_position: 1,
        aggregate_id: 'order-10',
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'OrderCreated',
        schema_version: 1,
        payload: {},
        event_hash: 'h1',
        causation_id: null,
        correlation_id: 'saga-wf-10',
        recorded_at: '2026-10-13T10:00:00Z',
      },
      {
        event_id: 'ev-order-confirmed',
        timeline_id: 'MAIN',
        timeline_position: 2,
        aggregate_id: 'order-10',
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderConfirmed',
        schema_version: 1,
        payload: {},
        event_hash: 'h2',
        causation_id: 'ev-order-created',
        correlation_id: 'saga-wf-10',
        recorded_at: '2026-10-13T10:01:00Z',
      },
      {
        event_id: 'ev-pay-authorized',
        timeline_id: 'MAIN',
        timeline_position: 3,
        aggregate_id: 'pay-10',
        aggregate_type: 'Payment',
        aggregate_sequence: 1,
        event_type: 'PaymentAuthorized',
        schema_version: 1,
        payload: {},
        event_hash: 'h3',
        causation_id: 'ev-order-confirmed',
        correlation_id: 'saga-wf-10',
        recorded_at: '2026-10-13T10:02:00Z',
      },
      {
        event_id: 'ev-inv-reserved',
        timeline_id: 'MAIN',
        timeline_position: 4,
        aggregate_id: 'inv-10',
        aggregate_type: 'Inventory',
        aggregate_sequence: 1,
        event_type: 'InventoryReserved',
        schema_version: 1,
        payload: {},
        event_hash: 'h4',
        causation_id: null, // Orchestrated step without direct causationId
        correlation_id: 'saga-wf-10',
        recorded_at: '2026-10-13T10:03:00Z',
      },
    ];

    const provider: CausalEventProvider = {
      getEventById(id: string) {
        return sagaEvents.find((e) => e.event_id === id) || null;
      },
      getEventsByCorrelationId(corrId: string) {
        return sagaEvents.filter((e) => e.correlation_id === corrId);
      },
    };

    const engine = new CausalGraphEngine(provider);
    const graph = await engine.buildWorkflowGraph('saga-wf-10');

    expect(graph.metrics.totalNodes).toBe(4);
    expect(graph.metrics.causationEdges).toBe(2);
    // Across pay-10 to inv-10, a WorkflowEdge is introduced
    expect(graph.metrics.workflowEdges).toBeGreaterThan(0);

    const workflowEdges = graph.edges.filter((e) => e.type === 'WORKFLOW');
    expect(workflowEdges).toHaveLength(2);
    expect(workflowEdges[0]).toMatchObject({
      type: 'WORKFLOW',
      source: 'ev-order-confirmed',
      target: 'ev-pay-authorized',
    });
    expect(workflowEdges[1]).toMatchObject({
      type: 'WORKFLOW',
      source: 'ev-pay-authorized',
      target: 'ev-inv-reserved',
    });
  });

  it('renders valid Graphviz DOT and Mermaid formats with styled edges', async () => {
    const events: DomainEvent[] = [
      {
        event_id: 'e1',
        timeline_id: 'MAIN',
        timeline_position: 1,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 1,
        event_type: 'OrderCreated',
        schema_version: 1,
        payload: {},
        event_hash: 'h1',
        causation_id: null,
        correlation_id: 'wf-1',
        recorded_at: '2026-10-13T10:00:00Z',
      },
      {
        event_id: 'e2',
        timeline_id: 'MAIN',
        timeline_position: 2,
        aggregate_id: 'order-1',
        aggregate_type: 'Order',
        aggregate_sequence: 2,
        event_type: 'OrderConfirmed',
        schema_version: 1,
        payload: {},
        event_hash: 'h2',
        causation_id: 'e1',
        correlation_id: 'wf-1',
        recorded_at: '2026-10-13T10:01:00Z',
      },
    ];

    const provider: CausalEventProvider = {
      getEventById(id: string) {
        return events.find((e) => e.event_id === id) || null;
      },
      getEventsByCorrelationId() {
        return events;
      },
    };

    const engine = new CausalGraphEngine(provider);
    const graph = await engine.buildWorkflowGraph('wf-1');

    const dot = engine.renderDot(graph);
    expect(dot).toContain('digraph ChronoscopeCausalGraph');
    expect(dot).toContain('"e1" -> "e2"');
    expect(dot).toContain('label="causation"');

    const mermaid = engine.renderMermaid(graph);
    expect(mermaid).toContain('flowchart LR');
    expect(mermaid).toContain('e1 ==>|causation| e2');
  });
});
