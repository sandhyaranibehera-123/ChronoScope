import type { FastifyPluginAsync } from 'fastify';
import { replayLiveRequestSchema, type ReplayLiveRequest } from '@chronoscope/contracts';
import type { LiveReplayService, IReplayWorkerClient } from '@chronoscope/replay-engine';
import type { IExecutionManager } from '@chronoscope/database';

export interface ReplayRoutesOptions {
  readonly liveReplayService?: LiveReplayService | undefined;
  readonly executionManager?: IExecutionManager | undefined;
  readonly replayWorkerClient?: IReplayWorkerClient | undefined;
}

export const replayRoutes: FastifyPluginAsync<ReplayRoutesOptions> = async (app, options) => {
  const replayService = options.liveReplayService;
  const executionManager = options.executionManager;
  const replayWorkerClient = options.replayWorkerClient;

  // POST /api/v1/replay/live — system-guarantees.md Rules 9, 11, 12, 19 (Phase 6 & 9)
  app.post<{ Body: ReplayLiveRequest }>('/api/v1/replay/live', async (req, reply) => {
    if (!replayService && !replayWorkerClient) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Neither LiveReplayService nor ReplayWorkerClient is configured',
      });
    }

    const parseResult = replayLiveRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    try {
      if (replayWorkerClient) {
        const grpcRes = await replayWorkerClient.executeReplay(
          {
            timelineId: parseResult.data.timelineId,
            aggregateId: parseResult.data.aggregateId,
            aggregateType: parseResult.data.aggregateType ?? 'Order',
            targetSequence: parseResult.data.targetSequence,
            mode: 'LIVE_REPLAY',
            useSnapshot: parseResult.data.useSnapshot ?? true,
            scenarioSeed: parseResult.data.scenarioSeed
              ? String(parseResult.data.scenarioSeed)
              : undefined,
          },
          {
            correlationId: req.id,
            requestId: req.id,
          },
        );

        return reply.status(200).send({
          executionId: grpcRes.executionId,
          timelineId: parseResult.data.timelineId,
          aggregateId: parseResult.data.aggregateId,
          aggregateType: parseResult.data.aggregateType ?? 'Order',
          fromSequence: 0,
          toSequence: parseResult.data.targetSequence ?? grpcRes.eventsReplayed,
          snapshotId: null,
          eventsReplayed: grpcRes.eventsReplayed,
          stateHash: grpcRes.stateHash,
          liveStateHash: grpcRes.liveStateHash,
          hashParityMatched: grpcRes.hashParityMatched,
          durationMs: 0,
        });
      }

      const result = await replayService!.replayAggregate(parseResult.data);
      return reply.status(200).send({
        executionId: result.executionId,
        timelineId: result.timelineId,
        aggregateId: result.aggregateId,
        aggregateType: result.aggregateType,
        fromSequence: result.fromSequence,
        toSequence: result.toSequence,
        snapshotId: result.snapshotId,
        eventsReplayed: result.eventsReplayed,
        stateHash: result.stateHash,
        liveStateHash: result.liveStateHash,
        hashParityMatched: result.hashParityMatched,
        durationMs: result.durationMs,
      });
    } catch (err) {
      const error = err as Error;
      req.log.error(error, 'Error executing LIVE_REPLAY');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  });

  // GET /api/v1/executions/:executionId
  app.get<{ Params: { executionId: string } }>(
    '/api/v1/executions/:executionId',
    async (req, reply) => {
      if (!executionManager) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'ExecutionManager is not configured',
        });
      }

      const { executionId } = req.params;
      const execution = await executionManager.getExecution(executionId);
      if (!execution) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Execution '${executionId}' not found`,
        });
      }

      return reply.status(200).send(execution);
    },
  );
};
