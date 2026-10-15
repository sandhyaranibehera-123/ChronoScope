import type { FastifyPluginAsync } from 'fastify';
import {
  forkTimelineRequestSchema,
  createScenarioInputRequestSchema,
  counterfactualReplayRequestSchema,
  diffTimelinesQuerySchema,
  type ForkTimelineRequest,
  type CreateScenarioInputRequest,
  type CounterfactualReplayRequest,
} from '@chronoscope/contracts';
import type {
  TimelineForkService,
  CounterfactualReplayService,
  TimelineDiffEngine,
} from '@chronoscope/replay-engine';
import type { IScenarioInputManager } from '@chronoscope/database';

export interface TimelineRoutesOptions {
  readonly timelineForkService?: TimelineForkService | undefined;
  readonly scenarioInputManager?: IScenarioInputManager | undefined;
  readonly counterfactualReplayService?: CounterfactualReplayService | undefined;
  readonly timelineDiffEngine?: TimelineDiffEngine | undefined;
}

export const timelineRoutes: FastifyPluginAsync<TimelineRoutesOptions> = async (app, options) => {
  const forkService = options.timelineForkService;
  const scenarioManager = options.scenarioInputManager;
  const counterfactualService = options.counterfactualReplayService;
  const diffEngine = options.timelineDiffEngine;

  // POST /api/v1/timelines/fork — Rules 6 & 13, ADR-010 (Phase 7)
  app.post<{ Body: ForkTimelineRequest }>('/api/v1/timelines/fork', async (req, reply) => {
    if (!forkService) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'TimelineForkService is not configured',
      });
    }

    const parseResult = forkTimelineRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    try {
      const created = await forkService.fork(parseResult.data);
      return reply.status(201).send(created);
    } catch (err) {
      const error = err as Error;
      req.log.error(error, 'Error creating timeline fork');
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: error.message,
      });
    }
  });

  // GET /api/v1/timelines/:timelineId — Timeline details & ancestry (Phase 7)
  app.get<{ Params: { timelineId: string } }>(
    '/api/v1/timelines/:timelineId',
    async (req, reply) => {
      if (!forkService) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'TimelineForkService is not configured',
        });
      }

      const { timelineId } = req.params;
      const timeline = await forkService.getTimeline(timelineId);
      if (!timeline) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Timeline ${timelineId} not found`,
        });
      }

      const ancestry = await forkService.getAncestry(timelineId);
      return reply.status(200).send({
        ...timeline,
        ancestry,
      });
    },
  );

  // POST /api/v1/timelines/:timelineId/scenario-inputs — Rule 12 & 27 (Phase 7)
  app.post<{ Params: { timelineId: string }; Body: CreateScenarioInputRequest }>(
    '/api/v1/timelines/:timelineId/scenario-inputs',
    async (req, reply) => {
      if (!scenarioManager) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'ScenarioInputManager is not configured',
        });
      }

      const parseResult = createScenarioInputRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          issues: parseResult.error.issues,
        });
      }

      const created = await scenarioManager.recordInput({
        timelineId: req.params.timelineId,
        aggregateId: parseResult.data.aggregateId ?? null,
        inputType: parseResult.data.inputType,
        parameters: parseResult.data.parameters ?? null,
      });

      return reply.status(201).send(created);
    },
  );

  // GET /api/v1/timelines/:timelineId/scenario-inputs
  app.get<{ Params: { timelineId: string } }>(
    '/api/v1/timelines/:timelineId/scenario-inputs',
    async (req, reply) => {
      if (!scenarioManager) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'ScenarioInputManager is not configured',
        });
      }

      const inputs = await scenarioManager.getInputsByTimeline(req.params.timelineId);
      return reply.status(200).send(inputs);
    },
  );

  // POST /api/v1/replay/counterfactual — Rule 12 (Phase 7)
  app.post<{ Body: CounterfactualReplayRequest }>(
    '/api/v1/replay/counterfactual',
    async (req, reply) => {
      if (!counterfactualService) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'CounterfactualReplayService is not configured',
        });
      }

      const parseResult = counterfactualReplayRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          issues: parseResult.error.issues,
        });
      }

      try {
        const result = await counterfactualService.replayAggregate(parseResult.data);
        return reply.status(200).send({
          executionId: result.executionId,
          mode: 'COUNTERFACTUAL_REPLAY',
          timelineId: result.timelineId,
          aggregateId: result.aggregateId,
          aggregateType: result.aggregateType,
          eventsReplayed: result.eventsReplayed,
          stateHash: result.stateHash,
          liveStateHash: result.liveStateHash,
          hashParityMatched: result.hashParityMatched,
          state: result.state,
          durationMs: result.durationMs,
        });
      } catch (err) {
        const error = err as Error;
        req.log.error(error, 'Error executing COUNTERFACTUAL_REPLAY');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: error.message,
        });
      }
    },
  );

  // GET /api/v1/timelines/diff — Phase 7 Diff Engine
  app.get<{ Querystring: { timelineIdA?: string; timelineIdB?: string; aggregateId?: string } }>(
    '/api/v1/timelines/diff',
    async (req, reply) => {
      if (!diffEngine) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'TimelineDiffEngine is not configured',
        });
      }

      const parseResult = diffTimelinesQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          issues: parseResult.error.issues,
        });
      }

      const diffResult = await diffEngine.diff({
        timelineIdA: parseResult.data.timelineIdA,
        timelineIdB: parseResult.data.timelineIdB,
        aggregateId: parseResult.data.aggregateId,
      });

      return reply.status(200).send(diffResult);
    },
  );
};
