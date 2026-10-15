import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { faultInjectionRequestSchema } from '@chronoscope/contracts';
import type { IChaosEngine } from '@chronoscope/chaos';

export interface ChaosRoutesOptions {
  readonly chaosEngine?: IChaosEngine | undefined;
}

async function extractActor(
  request: FastifyRequest,
): Promise<{ actorRole: string; actorId: string }> {
  try {
    if (request.headers.authorization) {
      await request.jwtVerify();
      const user = request.user as { role?: string; sub?: string } | undefined;
      return {
        actorRole: user?.role ?? 'viewer',
        actorId: user?.sub ?? 'jwt-operator',
      };
    }
  } catch {
    // invalid token -> default to unprivileged viewer
  }
  return { actorRole: 'viewer', actorId: 'anonymous' };
}

export const chaosRoutes: FastifyPluginAsync<ChaosRoutesOptions> = async (app, options) => {
  const chaosEngine = options.chaosEngine;

  app.post('/api/v1/chaos/inject', async (request, reply) => {
    if (!chaosEngine) {
      return reply.status(503).send({ error: 'Chaos engine is not configured' });
    }

    const parseResult = faultInjectionRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        issues: parseResult.error.issues,
      });
    }

    const { actorRole, actorId } = await extractActor(request);

    try {
      const activeFault = await chaosEngine.inject(parseResult.data, actorRole, actorId);
      return reply.status(201).send(activeFault);
    } catch (error) {
      if (error instanceof Error && error.name === 'ChaosDisabledError') {
        return reply.status(403).send({ error: error.message });
      }
      if (error instanceof Error && error.name === 'ChaosUnauthorizedError') {
        return reply.status(401).send({ error: error.message });
      }
      if (error instanceof Error && error.name === 'ChaosLimitExceededError') {
        return reply.status(429).send({ error: error.message });
      }
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Unknown chaos injection error',
      });
    }
  });

  app.get('/api/v1/chaos/active', async (_request, reply) => {
    if (!chaosEngine) {
      return reply.send({ activeFaults: [] });
    }
    return reply.send({ activeFaults: chaosEngine.getActiveFaults() });
  });

  app.post('/api/v1/chaos/disarm/:faultId', async (request, reply) => {
    if (!chaosEngine) {
      return reply.status(503).send({ error: 'Chaos engine is not configured' });
    }

    const { faultId } = request.params as { faultId: string };
    const { actorRole, actorId } = await extractActor(request);

    try {
      await chaosEngine.disarm(faultId, actorRole, actorId);
      return reply.send({ success: true, faultId });
    } catch (error) {
      if (error instanceof Error && error.name === 'FaultNotFoundError') {
        return reply.status(404).send({ error: error.message });
      }
      if (error instanceof Error && error.name === 'ChaosUnauthorizedError') {
        return reply.status(401).send({ error: error.message });
      }
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Unknown disarm error',
      });
    }
  });

  app.post('/api/v1/chaos/kill-switch', async (request, reply) => {
    if (!chaosEngine) {
      return reply.status(503).send({ error: 'Chaos engine is not configured' });
    }

    const { actorRole, actorId } = await extractActor(request);

    try {
      const response = await chaosEngine.disarmAll(actorRole, actorId);
      return reply.send(response);
    } catch (error) {
      if (error instanceof Error && error.name === 'ChaosUnauthorizedError') {
        return reply.status(401).send({ error: error.message });
      }
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Unknown kill switch error',
      });
    }
  });
};
