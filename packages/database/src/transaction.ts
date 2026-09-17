import type { Pool, PoolConnection } from 'mysql2/promise';

/**
 * Runs `fn` inside a single MySQL transaction on one connection.
 * Commits on success, rolls back and rethrows on any error.
 *
 * This is the building block every later-phase repository transaction
 * (event append, outbox insert, inbox/checkpoint commit, ...) is built on —
 * intentionally minimal in Phase 1 since there's no domain logic to wrap yet.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
