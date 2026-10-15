import { z } from 'zod';

/**
 * Phase 1 environment contract.
 * Grows per-phase: Mongo vars are already accepted (optional) since Phase 4
 * only requires them once the read-store package is created — validating
 * their shape now costs nothing and avoids a breaking schema change later.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // MySQL — write side (chronoscope_core / chronoscope_ops)
  MYSQL_HOST: z.string().min(1).default('localhost'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1).default('chronoscope_app'),
  MYSQL_PASSWORD: z.string().min(1).default('chronoscope_app_secret'),
  MYSQL_DATABASE: z.string().min(1).default('chronoscope_core'),
  DATABASE_URL: z.string().min(1).optional(),

  MYSQL_MIGRATOR_USER: z.string().min(1).default('chronoscope_migrator'),
  MYSQL_MIGRATOR_PASSWORD: z.string().min(1).optional(),

  // Redis
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // MongoDB — read side (rule: optional until packages/read-store exists, Phase 4)
  MONGO_URL: z.string().min(1).optional(),

  // RabbitMQ — work queue (Phase 9)
  RABBITMQ_URL: z.string().min(1).default('amqp://guest:guest@localhost:5672'),

  // gRPC Replay Worker (Phase 9)
  REPLAY_WORKER_GRPC_URL: z.string().min(1).default('localhost:50051'),

  // NATS — Control plane transport (Phase 10)
  NATS_URL: z.string().min(1).default('nats://localhost:4222'),

  // Dev-mode auth (rule 1.7 of the plan — never a public token-grant endpoint)
  DEV_AUTH_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  JWT_SECRET: z.string().min(16).default('chronoscope-dev-secret-change-me-24chars'),
  JWT_EXPIRY: z.string().min(1).default('15m'),

  // Chaos mode (Rule 21 — required for fault injection)
  CHAOS_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
