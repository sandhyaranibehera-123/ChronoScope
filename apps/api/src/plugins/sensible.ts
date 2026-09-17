import sensible from '@fastify/sensible';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export default fp(async function sensiblePlugin(app: FastifyInstance) {
  await app.register(sensible);
});
