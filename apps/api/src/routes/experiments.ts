import type { FastifyPluginAsync } from 'fastify';
import { createExperimentRequestSchema, runExperimentRequestSchema } from '@chronoscope/contracts';
import type { IExperimentManager } from '@chronoscope/database';
import type { ExperimentRunner } from '@chronoscope/chaos';

export interface ExperimentRoutesOptions {
  readonly experimentManager?: IExperimentManager | undefined;
  readonly experimentRunner?: ExperimentRunner | undefined;
}

export const experimentRoutes: FastifyPluginAsync<ExperimentRoutesOptions> = async (
  app,
  options,
) => {
  const manager = options.experimentManager;
  const runner = options.experimentRunner;

  app.post('/api/v1/experiments', async (request, reply) => {
    if (!manager) {
      return reply.status(503).send({ error: 'Experiment manager is not configured' });
    }

    const parseResult = createExperimentRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    await manager.registerExperiment(parseResult.data);
    const created = await manager.getExperiment(parseResult.data.experimentId);
    return reply.status(201).send(created);
  });

  app.get('/api/v1/experiments', async (_request, reply) => {
    if (!manager) {
      return reply.send({ experiments: [] });
    }
    const experiments = await manager.listExperiments();
    return reply.send({ experiments });
  });

  app.get('/api/v1/experiments/:experimentId', async (request, reply) => {
    if (!manager) {
      return reply.status(503).send({ error: 'Experiment manager is not configured' });
    }

    const { experimentId } = request.params as { experimentId: string };
    const experiment = await manager.getExperiment(experimentId);
    if (!experiment) {
      return reply.status(404).send({ error: `Experiment '${experimentId}' not found` });
    }
    return reply.send(experiment);
  });

  app.post('/api/v1/experiments/:experimentId/run', async (request, reply) => {
    if (!runner) {
      return reply.status(503).send({ error: 'Experiment runner is not configured' });
    }

    const { experimentId } = request.params as { experimentId: string };
    const parseResult = runExperimentRequestSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    const actorRole = (request.user as { role?: string } | undefined)?.role ?? 'viewer';
    const actorId = (request.user as { sub?: string } | undefined)?.sub ?? 'anonymous';

    try {
      const runRecord = await runner.runExperiment({
        experimentId,
        runId: parseResult.data.runId,
        scenarioSeed: parseResult.data.scenarioSeed,
        workload: parseResult.data.workload,
        warmUp: parseResult.data.warmUp,
        actorRole,
        actorId,
      });
      return reply.status(201).send(runRecord);
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Unknown experiment execution error',
      });
    }
  });

  app.get('/api/v1/experiments/runs/:runId', async (request, reply) => {
    if (!manager) {
      return reply.status(503).send({ error: 'Experiment manager is not configured' });
    }

    const { runId } = request.params as { runId: string };
    const run = await manager.getRun(runId);
    if (!run) {
      return reply.status(404).send({ error: `Experiment run '${runId}' not found` });
    }

    const invariants = await manager.getRunInvariants(runId);
    return reply.send({
      ...run,
      invariants,
    });
  });
};
