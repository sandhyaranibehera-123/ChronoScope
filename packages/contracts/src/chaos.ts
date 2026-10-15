import { z } from 'zod';

export const faultLayerSchema = z.enum(['APPLICATION', 'DEPENDENCY', 'INFRASTRUCTURE']);
export type FaultLayer = z.infer<typeof faultLayerSchema>;

export const faultTypeSchema = z.enum([
  // Application layer
  'LATENCY',
  'EXCEPTION',
  'CORRUPT_PAYLOAD',
  'DROPPED_MESSAGE',
  // Dependency layer
  'MYSQL_UNAVAILABLE',
  'MONGODB_UNAVAILABLE',
  'REDIS_UNAVAILABLE',
  'KAFKA_UNAVAILABLE',
  'RABBITMQ_UNAVAILABLE',
  'NATS_UNAVAILABLE',
  // Infrastructure layer
  'CONTAINER_PAUSE',
  'CONTAINER_STOP',
  'CONTAINER_RESTART',
  'NETWORK_PARTITION',
]);
export type FaultType = z.infer<typeof faultTypeSchema>;

export const faultParametersSchema = z.object({
  latencyMs: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
  probability: z.number().min(0).max(1).default(1.0),
  containerName: z.string().optional(),
  networkName: z.string().optional(),
  extra: z.record(z.unknown()).optional(),
});
export type FaultParameters = z.infer<typeof faultParametersSchema>;

export const faultInjectionRequestSchema = z.object({
  faultId: z.string().uuid().optional(),
  layer: faultLayerSchema,
  type: faultTypeSchema,
  target: z.string().min(1),
  parameters: faultParametersSchema.optional(),
  ttlSeconds: z.number().int().min(1).max(300).default(60),
});
export type FaultInjectionRequest = z.infer<typeof faultInjectionRequestSchema>;

export const activeFaultSchema = z.object({
  faultId: z.string().uuid(),
  layer: faultLayerSchema,
  type: faultTypeSchema,
  target: z.string().min(1),
  parameters: faultParametersSchema,
  injectedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  injectedBy: z.string().default('admin'),
});
export type ActiveFault = z.infer<typeof activeFaultSchema>;

export const chaosKillSwitchResponseSchema = z.object({
  disarmedCount: z.number().int().nonnegative(),
  disarmedFaultIds: z.array(z.string().uuid()),
  timestamp: z.string().datetime(),
});
export type ChaosKillSwitchResponse = z.infer<typeof chaosKillSwitchResponseSchema>;
