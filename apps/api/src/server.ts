import Fastify, { type FastifyInstance } from 'fastify';
import { getEnv } from './config/env.js';
import corsPlugin from './plugins/cors.js';
import helmetPlugin from './plugins/helmet.js';
import sensiblePlugin from './plugins/sensible.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';

/**
 * Builds a fully-configured Fastify instance without starting it listening —
 * testable in isolation. Uses Fastify's own built-in Pino integration
 * (`logger: {...}`) rather than injecting a separately-constructed
 * `@chronoscope/observability` instance — Fastify's and Pino's TypeScript
 * definitions don't structurally match closely enough under this project's
 * strict `exactOptionalPropertyTypes` setting for `loggerInstance` to
 * typecheck cleanly. `@chronoscope/observability`'s `createLogger` remains
 * the shared logger for non-Fastify contexts (the worker app, the CLI).
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: getEnv().LOG_LEVEL } });

  await app.register(sensiblePlugin);
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(authPlugin);
  await app.register(healthRoutes);

  return app;
}
