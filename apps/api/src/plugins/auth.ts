import jwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Registers JWT *verification* only. This API never issues tokens itself —
 * per rule 1.7 of the plan, the only way to mint a dev token is the local
 * CLI (`chronoscope token --role researcher`), gated behind DEV_AUTH_MODE.
 * There is deliberately no `POST /auth/token` route here: a public
 * token-grant endpoint would be a security anti-pattern even in dev mode.
 *
 * Per-route RBAC enforcement (checking the token's `role` claim against
 * what a route requires) is Phase 14 — this plugin only proves a request
 * carries a validly-signed token, nothing about authorization yet.
 */
export default fp(async function authPlugin(app: FastifyInstance) {
  const env = getEnv();

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    if (!env.DEV_AUTH_MODE) {
      // Real, persisted auth lands Phase 14. Until then, disabling
      // DEV_AUTH_MODE disables the only auth path that exists at all.
      return reply.unauthorized('Authentication is not configured (DEV_AUTH_MODE=false).');
    }
    try {
      await request.jwtVerify();
    } catch {
      return reply.unauthorized('Invalid or missing token.');
    }
  });
});
