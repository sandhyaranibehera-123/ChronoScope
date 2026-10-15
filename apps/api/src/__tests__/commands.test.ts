import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ORDER_AGGREGATE_TYPE, type OrderState } from '@chronoscope/domain';
import {
  InMemoryAggregateRepository,
  InMemoryCommandDeduplicationManager,
} from '@chronoscope/database';
import type { CommandSuccessResponse } from '@chronoscope/contracts';
import { buildServer } from '../server.js';

describe('API Command Routes & Deduplication (Rules 7, 8, 16)', () => {
  let app: FastifyInstance;
  let orderRepo: InMemoryAggregateRepository<OrderState>;
  let dedupManager: InMemoryCommandDeduplicationManager;

  const timelineId = '00000000-0000-0000-0000-000000000001';
  const aggregateId = 'order-test-123';

  beforeEach(async () => {
    orderRepo = new InMemoryAggregateRepository<OrderState>(ORDER_AGGREGATE_TYPE);
    dedupManager = new InMemoryCommandDeduplicationManager();

    app = await buildServer({
      orderRepository: orderRepo,
      commandDedupManager: dedupManager,
    });
  });

  it('dispatches CreateOrder successfully and produces resulting sequence 1', async () => {
    const commandId = randomUUID();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/order',
      payload: {
        command_id: commandId,
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        actor_id: 'user-alice',
        timeline_id: timelineId,
        aggregate_id: aggregateId,
        expected_sequence: 0,
        type: 'CreateOrder',
        payload: {
          customer_id: 'cust-456',
          currency: 'INR',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<CommandSuccessResponse>();
    expect(body.success).toBe(true);
    expect(body.command_id).toBe(commandId);
    expect(body.resulting_sequence).toBe(1);
    expect(body.deduplicated).toBe(false);
    expect(body.state_hash).toBeDefined();

    // Verify stored aggregate state
    const loaded = await orderRepo.load(timelineId, aggregateId);
    expect(loaded).not.toBeNull();
    expect(loaded?.sequence).toBe(1);
    expect(loaded?.state.status).toBe('CREATED');
  });

  it('returns identical cached result with zero re-execution when receiving duplicate command_id (Rule 8)', async () => {
    const commandId = randomUUID();

    const payload = {
      command_id: commandId,
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      actor_id: 'user-alice',
      timeline_id: timelineId,
      aggregate_id: aggregateId,
      expected_sequence: 0,
      type: 'CreateOrder',
      payload: {
        customer_id: 'cust-456',
        currency: 'INR',
      },
    };

    // First execution
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/order',
      payload,
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json<CommandSuccessResponse>();
    expect(body1.deduplicated).toBe(false);

    // Duplicate command submission
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/order',
      payload,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json<CommandSuccessResponse>();
    expect(body2.deduplicated).toBe(true);
    expect(body2.command_id).toBe(body1.command_id);
    expect(body2.resulting_sequence).toBe(body1.resulting_sequence);
    expect(body2.state_hash).toBe(body1.state_hash);

    // Ensure events list only contains 1 event (zero re-execution)
    const events = orderRepo.getEvents(timelineId, aggregateId);
    expect(events.length).toBe(1);
  });

  it('returns 409 Concurrency Conflict on unexpected sequence and records dedup failure', async () => {
    const commandId = randomUUID();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/order',
      payload: {
        command_id: commandId,
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        actor_id: 'user-alice',
        timeline_id: timelineId,
        aggregate_id: aggregateId,
        expected_sequence: 5, // Aggregate doesn't exist yet, expected 0
        type: 'CreateOrder',
        payload: {
          customer_id: 'cust-456',
          currency: 'INR',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.category).toBe('CONCURRENCY_CONFLICT');

    // Duplicate submission returns cached failure
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/order',
      payload: {
        command_id: commandId,
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        actor_id: 'user-alice',
        timeline_id: timelineId,
        aggregate_id: aggregateId,
        expected_sequence: 5,
        type: 'CreateOrder',
        payload: {
          customer_id: 'cust-456',
          currency: 'INR',
        },
      },
    });
    expect(dupRes.statusCode).toBe(400); // Cached error returned
    expect(dupRes.json().deduplicated).toBe(true);
  });
});
