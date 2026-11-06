import cors from '@fastify/cors';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export default fp(async function corsPlugin(app: FastifyInstance) {
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-request-id',
      'x-idempotency-key',
      'x-command-id',
    ],
    credentials: true,
  });
});
