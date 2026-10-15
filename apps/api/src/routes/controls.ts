import type { FastifyPluginAsync } from 'fastify';
import {
  updateWorkerControlRequestSchema,
  createControlCommandRequestSchema,
  cancelControlCommandRequestSchema,
  controlCommandListQuerySchema,
} from '@chronoscope/contracts';
import type { IWorkerControlManager, IControlCommandManager } from '@chronoscope/database';
import type { ControlDispatcher } from '@chronoscope/messaging';

export interface ControlRoutesOptions {
  workerControlManager?: IWorkerControlManager | undefined;
  controlCommandManager?: IControlCommandManager | undefined;
  controlDispatcher?: ControlDispatcher | undefined;
}

export const controlRoutes: FastifyPluginAsync<ControlRoutesOptions> = async (fastify, options) => {
  const workerControlManager = options.workerControlManager;
  const controlCommandManager = options.controlCommandManager;
  const controlDispatcher = options.controlDispatcher;

  // 1. Worker Controls (OCC-versioned desired-state)
  fastify.get('/api/v1/controls/workers', async (_req, reply) => {
    if (!workerControlManager) {
      return reply.status(503).send({ error: 'WorkerControlManager not configured' });
    }
    const workers = await workerControlManager.list();
    return reply.status(200).send({ data: workers });
  });

  fastify.get<{ Params: { target: string } }>(
    '/api/v1/controls/workers/:target',
    async (req, reply) => {
      if (!workerControlManager) {
        return reply.status(503).send({ error: 'WorkerControlManager not configured' });
      }
      const worker = await workerControlManager.get(req.params.target);
      if (!worker) {
        return reply.status(404).send({ error: `Worker target '${req.params.target}' not found` });
      }
      return reply.status(200).send({ data: worker });
    },
  );

  fastify.put<{ Params: { target: string }; Body: unknown }>(
    '/api/v1/controls/workers/:target',
    async (req, reply) => {
      if (!workerControlManager) {
        return reply.status(503).send({ error: 'WorkerControlManager not configured' });
      }

      const parseResult = updateWorkerControlRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          issues: parseResult.error.format(),
        });
      }

      try {
        const updated = await workerControlManager.setDesiredState(
          req.params.target,
          parseResult.data,
        );

        if (controlDispatcher) {
          await controlDispatcher.publishWorkerDesiredState(updated);
        }

        return reply.status(200).send({ data: updated });
      } catch (err: unknown) {
        const error = err as Error & { category?: string; code?: string };
        if (
          error.category === 'CONCURRENCY_CONFLICT' ||
          error.code === 'ERR_WORKER_CONTROL_OCC_CONFLICT'
        ) {
          return reply.status(409).send({
            error: 'Concurrency Conflict',
            message: error.message,
          });
        }
        if (error.category === 'NOT_FOUND') {
          return reply.status(404).send({ error: error.message });
        }
        throw err;
      }
    },
  );

  // 2. Control Commands (One-shot commands & two-phase cancellation)
  fastify.post<{ Body: unknown }>('/api/v1/controls/commands', async (req, reply) => {
    if (!controlCommandManager) {
      return reply.status(503).send({ error: 'ControlCommandManager not configured' });
    }

    const parseResult = createControlCommandRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        issues: parseResult.error.format(),
      });
    }

    const { command, isNew } = await controlCommandManager.issueCommand(parseResult.data);

    if (isNew && controlDispatcher) {
      await controlDispatcher.publishControlCommand(command);
    }

    return reply.status(isNew ? 201 : 200).send({
      data: command,
      isNew,
    });
  });

  fastify.get<{ Params: { commandId: string } }>(
    '/api/v1/controls/commands/:commandId',
    async (req, reply) => {
      if (!controlCommandManager) {
        return reply.status(503).send({ error: 'ControlCommandManager not configured' });
      }

      const command = await controlCommandManager.getCommandById(req.params.commandId);
      if (!command) {
        return reply
          .status(404)
          .send({ error: `Control command '${req.params.commandId}' not found` });
      }

      return reply.status(200).send({ data: command });
    },
  );

  fastify.post<{ Params: { commandId: string }; Body: unknown }>(
    '/api/v1/controls/commands/:commandId/cancel',
    async (req, reply) => {
      if (!controlCommandManager) {
        return reply.status(503).send({ error: 'ControlCommandManager not configured' });
      }

      const parseResult = cancelControlCommandRequestSchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          issues: parseResult.error.format(),
        });
      }

      try {
        const cancelled = await controlCommandManager.requestCancellation(req.params.commandId);

        if (controlDispatcher) {
          await controlDispatcher.publishCancellation(
            req.params.commandId,
            parseResult.data.reason,
          );
        }

        return reply.status(200).send({ data: cancelled });
      } catch (err: unknown) {
        const error = err as Error & { category?: string };
        if (error.category === 'PRECONDITION_FAILED') {
          return reply.status(412).send({ error: error.message });
        }
        if (error.category === 'NOT_FOUND') {
          return reply.status(404).send({ error: error.message });
        }
        throw err;
      }
    },
  );

  fastify.get<{ Querystring: unknown }>('/api/v1/controls/commands', async (req, reply) => {
    if (!controlCommandManager) {
      return reply.status(503).send({ error: 'ControlCommandManager not configured' });
    }

    const parseResult = controlCommandListQuerySchema.safeParse(req.query ?? {});
    const limit = parseResult.success ? parseResult.data.limit : 50;

    const commands = await controlCommandManager.listRecentCommands(limit);
    return reply.status(200).send({ data: commands });
  });
};
