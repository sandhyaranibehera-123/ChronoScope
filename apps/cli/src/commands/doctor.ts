import mysql from 'mysql2/promise';
import { createClient } from 'redis';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkMysql(): Promise<CheckResult> {
  const host = process.env['MYSQL_HOST'] ?? 'localhost';
  const port = Number(process.env['MYSQL_PORT'] ?? 3306);
  const user = process.env['MYSQL_USER'] ?? 'chronoscope_app';
  const password = process.env['MYSQL_PASSWORD'] ?? 'chronoscope_app_secret';
  try {
    const connection = await mysql.createConnection({ host, port, user, password, connectTimeout: 5000 });
    await connection.query('SELECT 1');
    await connection.end();
    return { name: 'MySQL', ok: true, detail: `${host}:${port}` };
  } catch (error) {
    return {
      name: 'MySQL',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const client = createClient({ url });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return { name: 'Redis', ok: true, detail: url };
  } catch (error) {
    return { name: 'Redis', ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    if (client.isOpen) await client.quit();
  }
}

/**
 * `chronoscope doctor` is mode-aware: it only reports on infrastructure
 * that's actually expected to be running right now, not "every service must
 * be up." In Phase 1-3 that's MySQL + Redis only — Kafka/RabbitMQ/NATS/
 * MinIO/MongoDB/the Chaos Agent all join this report in their own phases
 * (4, 9, 10, 6, 4, 11 respectively), each gated the same way.
 *
 * `doctor` stays infrastructure-liveness only — it never runs an expensive
 * DB audit (that's `chronoscope audit`, arriving Phase 16).
 */
export async function doctorCommand(): Promise<void> {
  console.log('CHRONOSCOPE DOCTOR');
  console.log('─'.repeat(40));
  console.log('Mode: Phase 1-3 default (MySQL + Redis required)\n');

  const results = await Promise.all([checkMysql(), checkRedis()]);
  for (const result of results) {
    const mark = result.ok ? '✓' : '✗';
    console.log(`${mark} ${result.name.padEnd(10)} ${result.detail}`);
  }

  console.log(
    '\n(Kafka/RabbitMQ/NATS/MinIO/MongoDB/Chaos Agent checks join this report in their own phases — not run yet.)',
  );

  const allOk = results.every((r) => r.ok);
  console.log(`\nResult: ${allOk ? 'READY' : 'NOT READY'}`);
  if (!allOk) {
    process.exitCode = 1;
  }
}
