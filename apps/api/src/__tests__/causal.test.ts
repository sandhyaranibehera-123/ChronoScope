import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DomainEvent } from '@chronoscope/domain';
import { CausalGraphEngine, type CausalEventProvider } from '@chronoscope/replay-engine';
import { buildServer } from '../server.js';

describe('API — Causal Graph & Root Cause Routes (Phase 8)', () => {
  let app: FastifyInstance;
  const sampleEvents: DomainEvent[] = [
    {
      event_id: 'ev-1',
      timeline_id: 'MAIN',
      timeline_position: 1,
      aggregate_id: 'order-10',
      aggregate_type: 'Order',
      aggregate_sequence: 1,
      event_type: 'OrderCreated',
      schema_version: 1,
      payload: { customerId: 'cust-1' },
      event_hash: 'h1',
      causation_id: null,
      correlation_id: 'wf-order-10',
      recorded_at: '2026-10-13T10:00:00Z',
    },
    {
      event_id: 'ev-2',
      timeline_id: 'MAIN',
      timeline_position: 2,
      aggregate_id: 'order-10',
      aggregate_type: 'Order',
      aggregate_sequence: 2,
      event_type: 'OrderConfirmed',
      schema_version: 1,
      payload: { amountMinor: 49995 },
      event_hash: 'h2',
      causation_id: 'ev-1',
      correlation_id: 'wf-order-10',
      recorded_at: '2026-10-13T10:01:00Z',
    },
    {
      event_id: 'ev-3',
      timeline_id: 'MAIN',
      timeline_position: 3,
      aggregate_id: 'pay-10',
      aggregate_type: 'Payment',
      aggregate_sequence: 1,
      event_type: 'PaymentFailed',
      schema_version: 1,
      payload: { reason: 'ForcePaymentFailure' },
      event_hash: 'h3',
      causation_id: 'ev-2',
      correlation_id: 'wf-order-10',
      recorded_at: '2026-10-13T10:02:00Z',
    },
  ];

  beforeEach(async () => {
    const provider: CausalEventProvider = {
      getEventById(id: string) {
        return sampleEvents.find((e) => e.event_id === id) || null;
      },
      getEventsByCorrelationId(corrId: string) {
        return sampleEvents.filter((e) => e.correlation_id === corrId);
      },
      getEventsByTimelineId(timelineId: string) {
        return sampleEvents.filter((e) => e.timeline_id === timelineId);
      },
      getEventsByCausationId(causationId: string) {
        return sampleEvents.filter((e) => e.causation_id === causationId);
      },
    };

    const engine = new CausalGraphEngine(provider);
    app = await buildServer({ causalGraphEngine: engine });
  });

  it('traces causality around an event (GET /api/v1/causal/events/:eventId)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/causal/events/ev-3?direction=upstream',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rootEventIds).toEqual(['ev-1']);
    expect(body.cycleDetected).toBe(false);
    expect(Object.keys(body.nodes)).toHaveLength(3);
    expect(body.edges).toHaveLength(2);
  });

  it('renders ASCII tree format when requested (GET /api/v1/causal/events/:eventId?format=ascii)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/causal/events/ev-3?direction=upstream&format=ascii',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('OrderCreated');
    expect(res.body).toContain('OrderConfirmed');
    expect(res.body).toContain('PaymentFailed');
    expect(res.body).toContain('CAUSATION');
  });

  it('renders Graphviz DOT format when requested (GET /api/v1/causal/events/:eventId?format=dot)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/causal/events/ev-3?direction=upstream&format=dot',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('digraph ChronoscopeCausalGraph');
    expect(res.body).toContain('"ev-2" -> "ev-3"');
  });

  it('explains root cause of an event (GET /api/v1/causal/events/:eventId/root-cause)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/causal/events/ev-3/root-cause',
    });

    expect(res.statusCode).toBe(200);
    const explanation = res.json();
    expect(explanation.targetEventId).toBe('ev-3');
    expect(explanation.targetEventType).toBe('PaymentFailed');
    expect(explanation.rootEventId).toBe('ev-1');
    expect(explanation.rootEventType).toBe('OrderCreated');
    expect(explanation.immediateCause).toEqual({
      eventId: 'ev-2',
      eventType: 'OrderConfirmed',
    });
    expect(explanation.narrative).toContain('PaymentFailed');
    expect(explanation.narrative).toContain('OrderCreated');
  });

  it('builds multi-aggregate workflow DAG (GET /api/v1/causal/workflows/:correlationId)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/causal/workflows/wf-order-10',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics.totalNodes).toBe(3);
    expect(body.cycleDetected).toBe(false);
  });

  it('returns 503 when causalGraphEngine is not configured', async () => {
    const serverWithoutEngine = await buildServer({});
    const res = await serverWithoutEngine.inject({
      method: 'GET',
      url: '/api/v1/causal/events/ev-1',
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('SERVICE_UNAVAILABLE');
  });
});
