import type { FastifyPluginAsync } from 'fastify';
import {
  createAggregateSnapshotRequestSchema,
  type CreateAggregateSnapshotRequest,
} from '@chronoscope/contracts';
import type { SnapshotManager } from '@chronoscope/replay-engine';

export interface SnapshotRoutesOptions {
  readonly snapshotManager?: SnapshotManager | undefined;
}

export const snapshotRoutes: FastifyPluginAsync<SnapshotRoutesOptions> = async (app, options) => {
  const snapshotManager = options.snapshotManager;

  // POST /api/v1/snapshots/aggregate — Rule 14 & ADR-009 (Phase 6)
  app.post<{ Body: CreateAggregateSnapshotRequest }>(
    '/api/v1/snapshots/aggregate',
    async (req, reply) => {
      if (!snapshotManager) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'SnapshotManager is not configured',
        });
      }

      const parseResult = createAggregateSnapshotRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          issues: parseResult.error.issues,
        });
      }

      try {
        const snapshot = await snapshotManager.createAggregateSnapshot(parseResult.data);
        return reply.status(201).send(snapshot);
      } catch (err) {
        const error = err as Error;
        req.log.error(error, 'Error capturing aggregate snapshot');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: error.message,
        });
      }
    },
  );

  // GET /api/v1/snapshots/:snapshotId
  app.get<{ Params: { snapshotId: string } }>(
    '/api/v1/snapshots/:snapshotId',
    async (req, reply) => {
      if (!snapshotManager) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'SnapshotManager is not configured',
        });
      }

      const { snapshotId } = req.params;
      const verified = await snapshotManager.loadAndVerifySnapshot(snapshotId);
      if (!verified) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Snapshot '${snapshotId}' not found or integrity verification failed`,
        });
      }

      return reply.status(200).send(verified.snapshot);
    },
  );
};
