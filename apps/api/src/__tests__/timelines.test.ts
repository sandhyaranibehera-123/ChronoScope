import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  InMemoryAggregateRepository,
  InMemoryScenarioInputManager,
  InMemoryExecutionManager,
} from '@chronoscope/database';
import {
  TimelineForkService,
  CounterfactualReplayService,
  TimelineDiffEngine,
  InMemoryEventReader,
} from '@chronoscope/replay-engine';
import { buildServer } from '../server.js';

describe('API — Timeline DAG, Scenario Inputs & Diff Routes (Phase 7)', () => {
  let app: FastifyInstance;
  let timelineRepo: InMemoryAggregateRepository<Record<string, unknown>>;
  let scenarioManager: InMemoryScenarioInputManager;
  let executionManager: InMemoryExecutionManager;
  const mainTimelineId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    timelineRepo = new InMemoryAggregateRepository('Order');
    scenarioManager = new InMemoryScenarioInputManager();
    executionManager = new InMemoryExecutionManager();

    const timelineForkService = new TimelineForkService({
      async createTimeline(params) {
        return timelineRepo.createTimeline(params as never) as never;
      },
      async getTimeline(timelineId) {
        return timelineRepo.getTimeline(timelineId) as never;
      },
      async getAncestry(timelineId) {
        return timelineRepo.getAncestry(timelineId);
      },
    });

    const eventReader = new InMemoryEventReader();
    const liveStateProvider = {
      async getLiveState() {
        return { sequence: 1, state: { status: 'CANCELLED' }, stateHash: 'mock-hash' };
      },
    };

    const counterfactualReplayService = new CounterfactualReplayService(
      eventReader,
      executionManager,
      scenarioManager,
      liveStateProvider,
    );

    const diffEngine = new TimelineDiffEngine({
      async getState() {
        return { state: { status: 'PAID' }, stateHash: 'hash-a' };
      },
      async getAncestry(timelineId) {
        return timelineRepo.getAncestry(timelineId);
      },
      async getEffectiveEvents(timelineId) {
        return timelineRepo.getEffectiveEvents(timelineId) as never;
      },
      async getScenarioInputs(timelineId) {
        return scenarioManager.getInputsByTimeline(timelineId);
      },
    });

    app = await buildServer({
      timelineForkService,
      scenarioInputManager: scenarioManager,
      counterfactualReplayService,
      timelineDiffEngine: diffEngine,
    });
  });

  it('POST /api/v1/timelines/fork creates branch timeline and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/timelines/fork',
      payload: {
        parentTimelineId: mainTimelineId,
        forkPosition: 0,
        name: 'BRANCH-TEST-1',
        description: 'Test branch',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('BRANCH-TEST-1');
    expect(body.parentTimelineId).toBe(mainTimelineId);
  });

  it('GET /api/v1/timelines/:timelineId returns timeline details with ancestry', async () => {
    // Fork a branch first
    timelineRepo.createTimeline({
      timelineId: 'branch-get-test',
      parentTimelineId: mainTimelineId,
      forkPosition: 0,
      name: 'Branch Get Test',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/timelines/branch-get-test',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timelineId).toBe('branch-get-test');
    expect(body.ancestry).toBeInstanceOf(Array);
    expect(body.ancestry).toHaveLength(2);
  });

  it('manages scenario inputs via POST and GET endpoints', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: `/api/v1/timelines/${mainTimelineId}/scenario-inputs`,
      payload: {
        inputType: 'ForcePaymentFailure',
        aggregateId: 'order-123',
        parameters: { code: 'SIMULATED' },
      },
    });

    expect(postRes.statusCode).toBe(201);
    const input = postRes.json();
    expect(input.inputType).toBe('ForcePaymentFailure');

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/timelines/${mainTimelineId}/scenario-inputs`,
    });

    expect(getRes.statusCode).toBe(200);
    const list = getRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].inputId).toBe(input.inputId);
  });

  it('GET /api/v1/timelines/diff computes diff between timelines', async () => {
    timelineRepo.createTimeline({
      timelineId: 'branch-diff-test',
      parentTimelineId: mainTimelineId,
      forkPosition: 0,
      name: 'Branch Diff Test',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/timelines/diff?timelineIdA=${mainTimelineId}&timelineIdB=branch-diff-test&aggregateId=order-1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timelineIdA).toBe(mainTimelineId);
    expect(body.timelineIdB).toBe('branch-diff-test');
    expect(body.commonAncestorTimelineId).toBe(mainTimelineId);
  });
});
