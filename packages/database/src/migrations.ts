import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const MIGRATION_LOCK_NAME = 'chronoscope:migrations';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

export interface MigrationRunnerConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** The MySQL user this runner MUST be connecting as — enforced, not assumed. */
  expectedUser?: string;
}

interface MigrationFile {
  version: string;
  filePath: string;
  sql: string;
  checksum: string;
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();

  const files: MigrationFile[] = [];
  for (const filename of sqlFiles) {
    const filePath = join(MIGRATIONS_DIR, filename);
    const sql = await readFile(filePath, 'utf-8');
    const checksum = createHash('sha256').update(sql, 'utf-8').digest('hex');
    files.push({ version: filename, filePath, sql, checksum });
  }
  return files;
}

/**
 * Hand-written, checksummed, advisory-locked MySQL migration runner.
 *
 * No migration framework, no ORM — raw numbered `.sql` files, matching the
 * project's "raw SQL, no hidden magic" principle applied to schema
 * management too. Deliberately re-derived from Postgres's advisory-lock
 * migration mutex: MySQL's `GET_LOCK()`/`RELEASE_LOCK()` are CONNECTION-scoped
 * (not transaction-scoped like Postgres) so the lock is explicitly released
 * in a `finally`, on the same connection that acquired it, for the whole
 * run — this is what stops two migrator processes from running concurrently.
 */
export async function runMigrations(config: MigrationRunnerConfig): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: true, // trusted, developer-authored migration files only — never user input
    timezone: 'Z',
  });

  try {
    if (config.expectedUser) {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT CURRENT_USER() AS currentUser',
      );
      const currentUser = String(rows[0]?.['currentUser'] ?? '');
      const currentUserName = currentUser.split('@')[0];
      if (currentUserName !== config.expectedUser) {
        throw new Error(
          `Migration runner must connect as '${config.expectedUser}', got '${currentUserName}'. ` +
            `Migrations are never run as the application role.`,
        );
      }
    }

    const [lockRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS],
    );
    if (lockRows[0]?.['acquired'] !== 1) {
      throw new Error(
        `Could not acquire migration lock '${MIGRATION_LOCK_NAME}' within ${MIGRATION_LOCK_TIMEOUT_SECONDS}s — another migrator may be running.`,
      );
    }

    try {
      await bootstrapTrackingTable(connection);
      const files = await loadMigrationFiles();
      const applied = await getAppliedMigrations(connection);

      for (const file of files) {
        const existing = applied.get(file.version);
        if (existing) {
          if (existing.checksum !== file.checksum) {
            throw new Error(
              `Checksum mismatch for already-applied migration '${file.version}': ` +
                `recorded ${existing.checksum}, file is now ${file.checksum}. ` +
                `A migration file must never change after it has been applied.`,
            );
          }
          continue;
        }

        console.log(`Applying migration ${file.version}...`);
        await connection.beginTransaction();
        try {
          await connection.query(file.sql);
          await connection.query(
            'INSERT INTO chronoscope_core.schema_migrations (version, checksum) VALUES (?, ?)',
            [file.version, file.checksum],
          );
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      }
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]);
    }
  } finally {
    await connection.end();
  }
}

async function bootstrapTrackingTable(connection: mysql.Connection): Promise<void> {
  // Bootstrap only — creates the tracking table itself so the runner has
  // somewhere to record that 0001_databases.sql (which creates chronoscope_core
  // and chronoscope_ops properly) has run. Idempotent, safe to run every time.
  await connection.query('CREATE DATABASE IF NOT EXISTS chronoscope_core');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS chronoscope_core.schema_migrations (
      version VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB
  `);
}

async function getAppliedMigrations(
  connection: mysql.Connection,
): Promise<Map<string, { checksum: string }>> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT version, checksum FROM chronoscope_core.schema_migrations',
  );
  return new Map(
    rows.map((row) => [String(row['version']), { checksum: String(row['checksum']) }]),
  );
}

async function main(): Promise<void> {
  const host = process.env['MYSQL_HOST'] ?? 'localhost';
  const port = Number(process.env['MYSQL_PORT'] ?? 3306);
  const user = process.env['MYSQL_MIGRATOR_USER'] ?? 'chronoscope_migrator';
  const password = process.env['MYSQL_MIGRATOR_PASSWORD'];

  if (!password) {
    throw new Error('MYSQL_MIGRATOR_PASSWORD is required to run migrations.');
  }

  await runMigrations({ host, port, user, password, expectedUser: user });
  console.log('Migrations complete.');
}

// Run directly only when invoked as a script (`npm run migrate`), not on import.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
