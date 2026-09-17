import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';

/**
 * Self-starting MySQL Testcontainer for `make integration`.
 * MongoDB's Testcontainers module is deliberately NOT added here yet — it
 * arrives in Phase 4 alongside packages/read-store, matching Mongo's own
 * introduction into the infra profile. Don't scaffold ahead of need.
 */
export async function startMysqlContainer(): Promise<StartedMySqlContainer> {
  return new MySqlContainer('mysql:8.4')
    .withDatabase('chronoscope_core')
    .withUsername('chronoscope_app')
    .withUserPassword('chronoscope_app_secret')
    .withRootPassword('chronoscope_root_secret')
    .start();
}
