import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { DependencyCheck } from '@chronoscope/contracts';
import { getMysqlPool } from '../lib/mysql.js';
import { getRedisClient } from '../lib/redis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function checkMysql(): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    const pool = getMysqlPool();
    await pool.query('SELECT 1');
    return { status: 'ok', latencyMs: performance.now() - start };
  } catch (error) {
    return {
      status: 'fail',
      latencyMs: performance.now() - start,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

async function checkRedis(): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    const client = getRedisClient();
    if (!client.isOpen) {
      await client.connect();
    }
    await client.ping();
    return { status: 'ok', latencyMs: performance.now() - start };
  } catch (error) {
    return {
      status: 'fail',
      latencyMs: performance.now() - start,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

/**
 * Health routes — deliberately split (rule: component-specific readiness).
 *
 * /health/live         — process is up, no dependency checks.
 * /health/version       — build metadata.
 * /health/ready/write   — MySQL + Redis only, the write-path dependencies.
 *                         MongoDB's own /health/ready/read arrives Phase 4;
 *                         folding it in here now would make a future Mongo
 *                         outage look identical to a MySQL outage, which is
 *                         exactly the distinction this project's chaos/
 *                         recovery design (Phase 11/12) depends on.
 */
export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => ({ status: 'live' as const }));

  app.get('/health/version', async () => ({
    version: readPackageVersion(),
    gitSha: process.env['GIT_SHA'] ?? 'unknown',
    nodeVersion: process.version,
  }));

  app.get('/health/ready/write', async (_request, reply) => {
    const [mysql, redis] = await Promise.all([checkMysql(), checkRedis()]);
    const status = mysql.status === 'ok' && redis.status === 'ok' ? 'ready' : 'not_ready';
    if (status === 'not_ready') {
      reply.status(503);
    }
    return { status, checks: { mysql, redis } };
  });
}
