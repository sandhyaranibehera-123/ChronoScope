import { createPool, type Pool } from '@chronoscope/database';
import { getEnv } from '../config/env.js';

let pool: Pool | undefined;

/** Shared MySQL pool for the API process — created lazily, once. */
export function getMysqlPool(): Pool {
  if (!pool) {
    const env = getEnv();
    pool = createPool({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
    });
  }
  return pool;
}

export async function closeMysqlPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
