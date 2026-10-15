import { describe, expect, it } from 'vitest';
import { InMemoryExperimentManager } from '@chronoscope/database';
import { ChaosEngine, ExperimentRunner } from '@chronoscope/chaos';
import { buildServer } from '../server.js';

describe('Experiment Routes (Phase 11, Rule 22)', () => {
  it('registers, lists, and retrieves experiments', async () => {
    const experimentManager = new InMemoryExperimentManager();
    const chaosEngine = new ChaosEngine({ chaosEnabled: true });
    const experimentRunner = new ExperimentRunner(experimentManager, chaosEngine);

    const app = await buildServer({
      experimentManager,
      experimentRunner,
      chaosEngine,
    });

    // 1. POST /api/v1/experiments
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/experiments',
      payload: {
        experimentId: 'exp-api-test',
        name: 'API Experiment Registration Test',
        category: 'CHAOS',
        description: 'Tests API endpoints for experiments',
        hypothesis: 'Experiment is registered and queryable',
        steadyStateInvariants: {
          testPassed: true,
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().experimentId).toBe('exp-api-test');

    // 2. GET /api/v1/experiments
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/experiments',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().experiments).toHaveLength(1);

    // 3. GET /api/v1/experiments/:experimentId
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/experiments/exp-api-test',
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().name).toBe('API Experiment Registration Test');
  });

  it('runs experiment with complete manifest and retrieves run audit (Rule 22)', async () => {
    const experimentManager = new InMemoryExperimentManager();
    const chaosEngine = new ChaosEngine({ chaosEnabled: true });
    const experimentRunner = new ExperimentRunner(experimentManager, chaosEngine);

    await experimentManager.registerExperiment({
      experimentId: 'exp-run-test',
      name: 'Runnable Experiment Test',
      category: 'CHAOS',
      description: 'Tests executing experiment run via API',
      hypothesis: 'Experiment completes and records reproducibility manifest',
      steadyStateInvariants: { status: 'healthy' },
    });

    const app = await buildServer({
      experimentManager,
      experimentRunner,
      chaosEngine,
    });
    const adminToken = app.jwt.sign({ role: 'admin', sub: 'admin-tester' });

    // POST /api/v1/experiments/:experimentId/run
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/v1/experiments/exp-run-test/run',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        scenarioSeed: 'seed-api-run-99',
        workload: { queries: 25 },
      },
    });

    expect(runRes.statusCode).toBe(201);
    const runBody = runRes.json();
    expect(runBody.runId).toBeDefined();
    expect(runBody.status).toBe('COMPLETED');
    expect(runBody.manifest.machineProfile.mysqlVersion).toBeDefined();
    expect(runBody.manifest.machineProfile.mongodbVersion).toBeDefined();
    expect(runBody.manifest.machineProfile.mysqlImageDigest).toBeDefined();

    // GET /api/v1/experiments/runs/:runId
    const getRunRes = await app.inject({
      method: 'GET',
      url: `/api/v1/experiments/runs/${runBody.runId}`,
    });
    expect(getRunRes.statusCode).toBe(200);
    expect(getRunRes.json().runId).toBe(runBody.runId);
    expect(getRunRes.json().status).toBe('COMPLETED');
  });
});
