import { describe, expect, it } from 'vitest';
import { InMemoryJobManager } from '@chronoscope/database';
import { buildServer } from '../server.js';

describe('Jobs API Routes — /api/v1/jobs (Phase 9, Rules 8 & 10, ADR-005)', () => {
  it('submits a new background job and returns 201 Created', async () => {
    const jobManager = new InMemoryJobManager();
    const app = await buildServer({ jobManager });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        jobType: 'PROJECTION_REBUILD',
        idempotencyKey: 'rebuild-order-summary-api-1',
        payload: { projection: 'order_summary' },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.isNew).toBe(true);
    expect(body.job.jobId).toBeDefined();
    expect(body.job.jobType).toBe('PROJECTION_REBUILD');
    expect(body.job.status).toBe('PENDING');

    // Query back by ID
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${body.job.jobId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().jobId).toBe(body.job.jobId);
  });

  it('enforces idempotency and returns 200 with existing job on duplicate key', async () => {
    const jobManager = new InMemoryJobManager();
    const app = await buildServer({ jobManager });

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        jobType: 'SNAPSHOT_GENERATION',
        idempotencyKey: 'snap-ord-1-seq-10',
        payload: { aggregateId: 'ord-1', sequence: 10 },
      },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().isNew).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        jobType: 'SNAPSHOT_GENERATION',
        idempotencyKey: 'snap-ord-1-seq-10',
        payload: { aggregateId: 'ord-1', sequence: 10 },
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().isNew).toBe(false);
    expect(second.json().job.jobId).toBe(first.json().job.jobId);
  });

  it('lists recent jobs', async () => {
    const jobManager = new InMemoryJobManager();
    const app = await buildServer({ jobManager });

    await jobManager.createJob({
      jobType: 'BENCHMARK',
      idempotencyKey: 'bench-1',
      payload: { mode: 'throughput' },
    });
    await jobManager.createJob({
      jobType: 'EXPORT',
      idempotencyKey: 'export-1',
      payload: { format: 'json' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?limit=10',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.jobs).toHaveLength(2);
  });
});
