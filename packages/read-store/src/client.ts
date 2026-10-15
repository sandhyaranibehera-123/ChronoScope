import { MongoClient, type Db } from 'mongodb';

let globalClient: MongoClient | null = null;

export interface MongoConfig {
  url?: string;
  databaseName?: string;
}

export function getMongoUrl(): string {
  return (
    process.env['MONGO_URL'] ??
    'mongodb://chronoscope_mongo_root:chronoscope_mongo_secret@localhost:27017/chronoscope_read?authSource=admin'
  );
}

export function getMongoDatabaseName(): string {
  return process.env['MONGO_DATABASE'] ?? 'chronoscope_read';
}

/**
 * Returns a shared MongoClient instance configured for the single-node lab environment.
 */
export function getMongoClient(url?: string): MongoClient {
  if (!globalClient) {
    const connectionUrl = url ?? getMongoUrl();
    globalClient = new MongoClient(connectionUrl, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 3000,
      // Single-node lab: journal-acknowledged write concern (Rule 10)
      writeConcern: { w: 1, j: true },
    });
  }
  return globalClient;
}

/**
 * Returns the chronoscope_read Db instance.
 */
export function getMongoDatabase(config?: MongoConfig): Db {
  const client = getMongoClient(config?.url);
  const dbName = config?.databaseName ?? getMongoDatabaseName();
  return client.db(dbName);
}

/**
 * Probes MongoDB readiness with an explicit timeout race.
 */
export async function checkMongoReadiness(
  client?: MongoClient,
  timeoutMs: number = 1500,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const c = client ?? getMongoClient();
  const start = performance.now();

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`MongoDB check timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    const pingPromise = c.db('admin').command({ ping: 1 });
    await Promise.race([pingPromise, timeoutPromise]);
    return { ok: true, latencyMs: performance.now() - start };
  } catch (error) {
    return {
      ok: false,
      latencyMs: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Closes the shared MongoClient instance if open.
 */
export async function closeMongoClient(): Promise<void> {
  if (globalClient) {
    await globalClient.close();
    globalClient = null;
  }
}
