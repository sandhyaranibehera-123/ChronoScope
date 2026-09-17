import mysql from 'mysql2/promise';

export interface PoolConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  connectionLimit?: number;
}

/**
 * Small, explicit connection pool sized for an 8 GB host — this project
 * never wants an unbounded pool quietly exhausting host memory.
 *
 * Every physical connection gets `SET time_zone = '+00:00'` exactly once,
 * on creation (mysql2's `connection` pool event) — MySQL's DATETIME(6) type
 * has no timezone awareness at all, so this is the only thing that keeps
 * every stored timestamp unambiguously UTC. Sticking it on the pool's
 * `connection` event (rather than re-running it on every acquire) is
 * correct and cheaper: the session setting persists for the physical
 * connection's lifetime once set.
 *
 * A per-connection `statement_timeout`-equivalent (MySQL: `max_execution_time`,
 * milliseconds, SELECT-only) is set the same way, so a runaway query from a
 * later phase (replay, benchmark, chaos) can't starve the pool indefinitely.
 */
export function createPool(config: PoolConfig): mysql.Pool {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    ...(config.database !== undefined ? { database: config.database } : {}),
    connectionLimit: config.connectionLimit ?? 10,
    connectTimeout: 10_000,
    waitForConnections: true,
    queueLimit: 0,
    timezone: 'Z',
    decimalNumbers: false,
  });

  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'").catch(() => {
      // best-effort; a failure here surfaces on the next real query anyway
    });
    connection.query('SET SESSION max_execution_time = 30000').catch(() => {});
  });

  return pool;
}

export type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
