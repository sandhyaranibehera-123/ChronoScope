import type { FastifyPluginAsync } from 'fastify';
import { getOpenApiSpec } from '@chronoscope/contracts';

export const openapiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/openapi.json', async (_req, reply) => {
    const spec = getOpenApiSpec();
    return reply.status(200).send(spec);
  });
};
