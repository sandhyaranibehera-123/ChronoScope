import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export default fp(async function helmetPlugin(app: FastifyInstance) {
  await app.register(helmet);
});
