import { describe, expect, it, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { InMemoryOrderSummaryRepository } from '@chronoscope/read-store';
import { buildServer } from '../server.js';

describe('API Query Routes & OpenAPI Contract (Phase 5)', () => {
  let app: FastifyInstance;
  let orderSummaryRepo: InMemoryOrderSummaryRepository;

  const timelineId = '00000000-0000-0000-0000-000000000001';
  const aggregateId = 'order-query-test-999';

  beforeEach(async () => {
    orderSummaryRepo = new InMemoryOrderSummaryRepository();
    app = await buildServer({
      orderSummaryRepository: orderSummaryRepo,
    });
  });

  it('returns 404 when querying an order that does not exist in MongoDB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${timelineId}/${aggregateId}`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe('NOT_FOUND');
  });

  it('returns 200 and the read model document when it exists in MongoDB', async () => {
    // Seed MongoDB projection repository directly
    await orderSummaryRepo.upsertOrderSummary({
      timelineId,
      aggregateId,
      status: 'CONFIRMED',
      items: [
        {
          sku: 'SKU-SHIRT-M',
          quantity: 2,
          amountMinor: 2000,
        },
      ],
      totalAmountMinor: 4000,
      currency: 'INR',
      appliedSequence: 3,
      appliedTimelinePosition: 1042,
      appliedKafkaTopic: 'chronoscope.domain.events',
      appliedKafkaPartition: 0,
      appliedKafkaOffset: 50,
      appliedEventId: 'evt-111',
      sourceAggregateSequence: 3,
      sourceStateHash: 'a'.repeat(64),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${timelineId}/${aggregateId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body._id).toBe(`${timelineId}:${aggregateId}`);
    expect(body.timelineId).toBe(timelineId);
    expect(body.aggregateId).toBe(aggregateId);
    expect(body.status).toBe('CONFIRMED');
    expect(body.totalAmountMinor).toBe(4000);
    expect(body.appliedSequence).toBe(3);
    expect(body.projectionHash).toBeDefined();
    expect(body.projectionHash.length).toBe(64);
  });

  it('GET /openapi.json exposes the light OpenAPI 3.1 specification', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toContain('CHRONOSCOPE');
    expect(spec.paths['/api/v1/commands/order']).toBeDefined();
    expect(spec.paths['/api/v1/orders/{timelineId}/{aggregateId}']).toBeDefined();
    expect(spec.components.schemas['OrderCommandRequest']).toBeDefined();
  });
});
