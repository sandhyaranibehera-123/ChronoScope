import { createClient, type RedisClientType } from 'redis';
import { getEnv } from '../config/env.js';

let client: RedisClientType | undefined;

/**
 * Shared Redis client — rate limiting / ephemeral cache / worker heartbeat
 * only, never a correctness mechanism (system-guarantees.md rule 20).
 */
export function getRedisClient(): RedisClientType {
  if (!client) {
    client = createClient({
      url: getEnv().REDIS_URL,
      socket: {
        connectTimeout: 1500,
        reconnectStrategy: (retries: number) => {
          if (retries > 1) {
            return false;
          }
          return 50;
        },
      },
    });
    client.on('error', () => {
      // swallowed here; callers (e.g. the health check) observe failures
      // via their own operation timing out or rejecting, not via this handler
    });
  }
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    try {
      if (client.isOpen) {
        await client.quit();
      } else {
        await client.disconnect();
      }
    } catch {
      // best-effort cleanup
    } finally {
      client = undefined;
    }
  }
}
