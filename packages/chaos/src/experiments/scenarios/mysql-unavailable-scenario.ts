import type { IChaosEngine } from '../../types.js';

export interface MySqlUnavailableScenarioDeps {
  readonly executeWriteCommand: () => Promise<{ success: boolean; errorCategory?: string }>;
  readonly executeReadQuery: () => Promise<{ ok: boolean; status?: string }>;
}

/**
 * Phase 11 scenario: MySQL Unavailable (Dependency Layer Fault).
 *
 * Demonstrates fail-fast on authoritative write path while read-models remain available:
 * 1. Commands attempting to write fail-fast (rejected immediately with SYSTEM_ERROR).
 * 2. MongoDB continues serving previously materialized read models.
 */
export async function executeMySqlUnavailableScenario(
  chaosEngine: IChaosEngine,
  recordInvariant: (
    name: string,
    expected: unknown,
    measured: unknown,
    passed: boolean,
    details?: string,
  ) => Promise<void>,
  deps: MySqlUnavailableScenarioDeps,
): Promise<Record<string, unknown>> {
  // 1. Inject MYSQL_UNAVAILABLE fault
  const activeFault = await chaosEngine.inject(
    {
      layer: 'DEPENDENCY',
      type: 'MYSQL_UNAVAILABLE',
      target: 'mysql',
      ttlSeconds: 60,
    },
    'admin',
  );

  // 2. Verify write-path fails fast
  const writeResult = await deps.executeWriteCommand();
  const writeFailedFast = !writeResult.success && writeResult.errorCategory === 'SYSTEM_ERROR';
  await recordInvariant(
    'write_path_fail_fast_on_mysql_outage',
    { success: false, errorCategory: 'SYSTEM_ERROR' },
    { success: writeResult.success, errorCategory: writeResult.errorCategory },
    writeFailedFast,
    'Write commands rejected immediately with SYSTEM_ERROR when MySQL is down',
  );

  // 3. Verify read-path remains available from MongoDB
  const readResult = await deps.executeReadQuery();
  await recordInvariant(
    'read_path_available_from_mongo',
    { ok: true },
    { ok: readResult.ok, status: readResult.status },
    readResult.ok,
    'MongoDB query succeeded serving existing read-model data during MySQL outage',
  );

  // 4. Disarm fault
  await chaosEngine.disarm(activeFault.faultId, 'admin');

  return {
    writeFailedFast,
    readPathAvailable: readResult.ok,
  };
}
