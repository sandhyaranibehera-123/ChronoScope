import { describe, expect, it } from 'vitest';
import { InMemoryWorkerControlManager, InMemoryControlCommandManager } from '@chronoscope/database';
import { InMemoryNatsClient, ControlDispatcher } from '@chronoscope/messaging';
import { buildServer } from '../server.js';

describe('Control Routes (Phase 10, Rule 18 & ADR-006)', () => {
  it('supports worker control desired-state queries and OCC updates', async () => {
    const workerControlManager = new InMemoryWorkerControlManager();
    const commandManager = new InMemoryControlCommandManager();
    const nats = new InMemoryNatsClient();
    const controlDispatcher = new ControlDispatcher(nats);

    await workerControlManager.initTarget('projection_worker', {
      status: 'ACTIVE',
      concurrency: 2,
    });

    const app = await buildServer({
      workerControlManager,
      controlCommandManager: commandManager,
      controlDispatcher,
    });

    // 1. GET /api/v1/controls/workers
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/controls/workers',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data).toHaveLength(1);

    // 2. GET /api/v1/controls/workers/:target
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/controls/workers/projection_worker',
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.status).toBe('ACTIVE');
    expect(getRes.json().data.version).toBe(1);

    // 3. PUT /api/v1/controls/workers/:target with valid expectedVersion
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/controls/workers/projection_worker',
      payload: {
        status: 'PAUSED',
        expectedVersion: 1,
        concurrency: 4,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.status).toBe('PAUSED');
    expect(updateRes.json().data.version).toBe(2);

    // 4. PUT /api/v1/controls/workers/:target with stale expectedVersion -> 409 Conflict
    const staleRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/controls/workers/projection_worker',
      payload: {
        status: 'ACTIVE',
        expectedVersion: 1,
      },
    });
    expect(staleRes.statusCode).toBe(409);
    expect(staleRes.json().error).toBe('Concurrency Conflict');
  });

  it('supports issuing one-shot commands, deduplication, and cancellation', async () => {
    const workerControlManager = new InMemoryWorkerControlManager();
    const commandManager = new InMemoryControlCommandManager();
    const nats = new InMemoryNatsClient();
    const controlDispatcher = new ControlDispatcher(nats);

    const app = await buildServer({
      workerControlManager,
      controlCommandManager: commandManager,
      controlDispatcher,
    });

    const commandId = '00000000-0000-0000-0000-000000000100';

    // 1. POST /api/v1/controls/commands (New command)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/controls/commands',
      payload: {
        commandId,
        commandType: 'DRAIN_WORKER',
        targetWorker: 'worker',
        payload: { gracePeriodSeconds: 15 },
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().isNew).toBe(true);
    expect(createRes.json().data.commandId).toBe(commandId);

    // 2. Duplicate command_id returns 200 with isNew: false
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/controls/commands',
      payload: {
        commandId,
        commandType: 'DRAIN_WORKER',
        targetWorker: 'worker',
        payload: { gracePeriodSeconds: 15 },
      },
    });
    expect(dupRes.statusCode).toBe(200);
    expect(dupRes.json().isNew).toBe(false);

    // 3. GET /api/v1/controls/commands/:commandId
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/controls/commands/${commandId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.status).toBe('PENDING');

    // 4. POST /api/v1/controls/commands/:commandId/cancel
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/controls/commands/${commandId}/cancel`,
      payload: { reason: 'Operator requested abort' },
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.status).toBe('CANCELLATION_REQUESTED');
  });
});
