import { getEnv } from './config/env.js';
import { buildServer } from './server.js';
import { closeMysqlPool } from './lib/mysql.js';
import { closeRedisClient } from './lib/redis.js';

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await Promise.allSettled([closeMysqlPool(), closeRedisClient()]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
