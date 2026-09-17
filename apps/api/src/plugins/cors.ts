import cors from '@fastify/cors';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getEnv } from '../config/env.js';

export default fp(async function corsPlugin(app: FastifyInstance) {
  const env = getEnv();
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true,
  });
});
