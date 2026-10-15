import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import { Kafka } from 'kafkajs';
import { checkMongoReadiness } from '@chronoscope/read-store';

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
    const connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      connectTimeout: 5000,
    });
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
    return {
      name: 'Redis',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (client.isOpen) await client.quit();
  }
}

async function checkMongo(): Promise<CheckResult> {
  const host = process.env['MONGO_URL'] ?? 'localhost:27017';
  try {
    const res = await checkMongoReadiness(undefined, 3000);
    if (res.ok) {
      return { name: 'MongoDB', ok: true, detail: host };
    }
    return { name: 'MongoDB', ok: false, detail: res.error ?? 'Connection failed' };
  } catch (error) {
    return {
      name: 'MongoDB',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkKafka(): Promise<CheckResult> {
  const brokers = process.env['KAFKA_BROKERS']
    ? process.env['KAFKA_BROKERS'].split(',')
    : ['localhost:9092'];
  const kafka = new Kafka({
    clientId: 'chronoscope-doctor',
    brokers,
    connectionTimeout: 3000,
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    return { name: 'Kafka', ok: true, detail: brokers.join(',') };
  } catch (error) {
    return {
      name: 'Kafka',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkRabbitMq(): Promise<CheckResult> {
  const url = process.env['RABBITMQ_URL'] ?? 'amqp://guest:guest@localhost:5672';
  try {
    const amqp = await import('amqplib');
    const conn = await amqp.default.connect(url);
    await conn.close();
    return { name: 'RabbitMQ', ok: true, detail: url };
  } catch (error) {
    return {
      name: 'RabbitMQ',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkReplayWorker(): Promise<CheckResult> {
  const address = process.env['REPLAY_WORKER_GRPC_URL'] ?? 'localhost:50051';
  try {
    const { ReplayWorkerGrpcClient } = await import('@chronoscope/replay-engine');
    const client = new ReplayWorkerGrpcClient({ address });
    const res = await client.checkHealth(1500);
    client.close();
    return {
      name: 'ReplayWorker(gRPC)',
      ok: res.status === 'SERVING',
      detail: `${address} (${res.status})`,
    };
  } catch (error) {
    return {
      name: 'ReplayWorker(gRPC)',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkNats(): Promise<CheckResult> {
  const url = process.env['NATS_URL'] ?? 'nats://localhost:4222';
  try {
    const net = await import('node:net');
    return await new Promise<CheckResult>((resolve) => {
      const parsed = new URL(url.replace('nats://', 'http://'));
      const host = parsed.hostname || 'localhost';
      const port = Number(parsed.port || 4222);

      const socket = net.createConnection({ host, port, timeout: 2000 }, () => {
        socket.end();
        resolve({ name: 'NATS', ok: true, detail: `${host}:${port}` });
      });

      socket.on('error', (err) => {
        resolve({ name: 'NATS', ok: false, detail: err.message });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ name: 'NATS', ok: false, detail: 'Connection timed out' });
      });
    });
  } catch (error) {
    return {
      name: 'NATS',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * `chronoscope doctor` is mode-aware: in Phase 11, MySQL, Redis, MongoDB,
 * Kafka, RabbitMQ, ReplayWorker (gRPC), NATS, and Chaos Engine are active components.
 */
export async function doctorCommand(): Promise<void> {
  console.log('CHRONOSCOPE DOCTOR');
  console.log('─'.repeat(40));
  console.log(
    'Mode: Phase 11 (MySQL + Redis + MongoDB + Kafka + RabbitMQ + gRPC + NATS + Chaos active)\n',
  );

  const results = await Promise.all([
    checkMysql(),
    checkRedis(),
    checkMongo(),
    checkKafka(),
    checkRabbitMq(),
    checkReplayWorker(),
    checkNats(),
  ]);

  for (const result of results) {
    const mark = result.ok ? '✓' : '✗';
    console.log(`${mark} ${result.name.padEnd(20)} ${result.detail}`);
  }

  const isChaos = process.env['CHAOS_MODE'] === 'true';
  console.log(
    `\nChaos Engine:        ${isChaos ? 'ENABLED (CHAOS_MODE=true)' : 'DISARMED / SAFE (CHAOS_MODE=false)'}`,
  );

  const allOk = results.every((r) => r.ok);
  console.log(`\nResult: ${allOk ? 'READY' : 'NOT READY'}`);
  if (!allOk) {
    process.exitCode = 1;
  }
}
