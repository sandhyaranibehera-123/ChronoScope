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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${operationName} check timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkMysql(): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    const pool = getMysqlPool();
    await withTimeout(pool.query('SELECT 1'), 1500, 'MySQL');
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
    const run = async () => {
      if (!client.isOpen) {
        await client.connect();
      }
      await client.ping();
    };
    await withTimeout(run(), 1500, 'Redis');
    return { status: 'ok', latencyMs: performance.now() - start };
  } catch (error) {
    return {
      status: 'fail',
      latencyMs: performance.now() - start,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

async function checkMongo(): Promise<DependencyCheck> {
  try {
    const { checkMongoReadiness } = await import('@chronoscope/read-store');
    const res = await checkMongoReadiness(undefined, 1500);
    return {
      status: res.ok ? 'ok' : 'fail',
      latencyMs: res.latencyMs,
      error: res.error,
    };
  } catch (error) {
    return {
      status: 'fail',
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Health routes — deliberately split (rule: component-specific readiness).
 *
 * /health/live         — process is up, no dependency checks.
 * /health/version       — build metadata.
 * /health/ready/write   — MySQL + Redis only, the write-path dependencies.
 * /health/ready/read    — MongoDB only, the read/projection path dependencies (Phase 4).
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

  app.get('/health/ready/read', async (_request, reply) => {
    const mongo = await checkMongo();
    const status = mongo.status === 'ok' ? 'ready' : 'not_ready';
    if (status === 'not_ready') {
      reply.status(503);
    }
    return { status, checks: { mongo } };
  });
}
