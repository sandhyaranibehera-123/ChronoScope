import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';

/**
 * Self-starting MongoDB Testcontainer for `make integration` (Phase 4).
 * Matches single-node lab configuration for chronoscope_read.
 */
export async function startMongoContainer(): Promise<StartedMongoDBContainer> {
  return new MongoDBContainer('mongo:7').start();
}
