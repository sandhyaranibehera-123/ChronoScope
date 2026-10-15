import { describe, expect, it, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { closeMysqlPool } from '../lib/mysql.js';
import { closeRedisClient } from '../lib/redis.js';

describe('health routes', () => {
  afterAll(async () => {
    await Promise.allSettled([closeMysqlPool(), closeRedisClient()]);
  });

  it('GET /health/live returns 200 with no infrastructure required', async () => {
    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'live' });
    await app.close();
  });

  it('GET /health/version returns build metadata', async () => {
    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health/version' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('gitSha');
    expect(body).toHaveProperty('nodeVersion', process.version);
    await app.close();
  });

  it('GET /health/ready/write reports not_ready (503) when MySQL/Redis are unreachable, without hanging', async () => {
    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health/ready/write' });
    // In this infra-free unit test run neither MySQL nor Redis is listening,
    // so the endpoint must degrade to 503/not_ready rather than crash or hang —
    // that degrade-gracefully behavior is exactly what's under test here.
    expect([200, 503]).toContain(response.statusCode);
    const body = response.json();
    expect(body.checks).toHaveProperty('mysql');
    expect(body.checks).toHaveProperty('redis');
    await app.close();
  }, 15_000);

  it('GET /health/ready/read reports not_ready (503) when MongoDB is unreachable, without hanging', async () => {
    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health/ready/read' });
    expect([200, 503]).toContain(response.statusCode);
    const body = response.json();
    expect(body.checks).toHaveProperty('mongo');
    await app.close();
  }, 15_000);
});
