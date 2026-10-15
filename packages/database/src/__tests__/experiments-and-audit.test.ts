import { describe, it, expect } from 'vitest';
import { InMemoryExperimentManager } from '../experiments/in-memory-experiment-manager.js';
import { InMemoryAuditLogger } from '../audit/audit-logger.js';
import type { ExperimentManifest, MachineProfile } from '../experiments/types.js';

describe('Database — Experiments & Audit Managers (Phase 11, Rules 21 & 22)', () => {
  const machineProfile: MachineProfile = {
    mysqlVersion: '8.4.0',
    mongodbVersion: '7.0.5',
    mysqlImageDigest: 'sha256:mysql-test-digest',
    mongodbImageDigest: 'sha256:mongo-test-digest',
    nodeVersion: 'v24.0.0',
    dockerVersion: '26.1.0',
    osArch: 'darwin-arm64',
  };

  const manifest: ExperimentManifest = {
    gitSha: 'abcdef1234567890',
    schemaVersion: 12,
    domainLogicVersion: 1,
    appVersion: '0.1.0',
    datasetVersion: 'baseline-v1',
    configHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    scenarioSeed: 'seed-chaos-test-42',
    machineProfile,
    workload: { orders: 50, concurrency: 5 },
  };

  it('manages experiment registrations and listings', async () => {
    const experimentManager = new InMemoryExperimentManager();

    await experimentManager.registerExperiment({
      experimentId: 'exp-mongo-unavailable',
      name: 'MongoDB Unavailable Resilience Test',
      category: 'CHAOS',
      description: 'Verifies write-path continuity when read-store MongoDB fails',
      hypothesis:
        'MySQL event stream and outbox proceed normally; MongoDB projections catch up post-recovery',
      steadyStateInvariants: {
        writePathAvailability: '100%',
        zeroDataLoss: true,
      },
      faultConfig: {
        faultType: 'MONGODB_UNAVAILABLE',
        target: 'mongodb',
      },
    });

    const exp = await experimentManager.getExperiment('exp-mongo-unavailable');
    expect(exp).not.toBeNull();
    expect(exp?.name).toBe('MongoDB Unavailable Resilience Test');
    expect(exp?.category).toBe('CHAOS');

    const all = await experimentManager.listExperiments();
    expect(all).toHaveLength(1);
    expect(all[0]?.experimentId).toBe('exp-mongo-unavailable');
  });

  it('tracks experiment run lifecycle and evaluates invariants with full manifest (Rule 22)', async () => {
    const experimentManager = new InMemoryExperimentManager();

    await experimentManager.registerExperiment({
      experimentId: 'exp-mysql-unavailable',
      name: 'MySQL Unavailable Fail-Fast Test',
      category: 'CHAOS',
      description: 'Verifies fail-fast behavior when MySQL is unreachable',
      hypothesis: 'Write path fails fast; read path continues serving cached data',
      steadyStateInvariants: {
        failFastErrors: 'SYSTEM_ERROR',
      },
    });

    const runId = '00000000-0000-0000-0000-000000000001';
    const run = await experimentManager.startRun(runId, 'exp-mysql-unavailable', manifest);
    expect(run.status).toBe('RUNNING');
    expect(run.manifest.machineProfile.mysqlVersion).toBe('8.4.0');
    expect(run.manifest.machineProfile.mongodbVersion).toBe('7.0.5');

    // Record invariant evaluations
    await experimentManager.recordInvariant({
      invariantId: 'inv-1',
      runId,
      invariantName: 'write_path_failed_fast',
      status: 'PASSED',
      expectedValue: { rejected: true },
      measuredValue: { rejected: true },
      details: 'All commands rejected with SYSTEM_ERROR within 50ms',
    });

    await experimentManager.recordInvariant({
      invariantId: 'inv-2',
      runId,
      invariantName: 'read_store_still_serves_cached',
      status: 'PASSED',
      expectedValue: { readOk: true },
      measuredValue: { readOk: true },
      details: 'MongoDB read models returned existing orders successfully',
    });

    await experimentManager.completeRun(
      runId,
      'COMPLETED',
      true,
      { ordersFailedFast: 10, readsServed: 10 },
      undefined,
    );

    const completedRun = await experimentManager.getRun(runId);
    expect(completedRun?.status).toBe('COMPLETED');
    expect(completedRun?.invariantsPassed).toBe(true);
    expect(completedRun?.completedAt).toBeDefined();

    const invariants = await experimentManager.getRunInvariants(runId);
    expect(invariants).toHaveLength(2);
    expect(invariants[0]?.status).toBe('PASSED');
    expect(invariants[1]?.status).toBe('PASSED');
  });

  it('records structured audit log entries for chaos actions (Rule 21)', async () => {
    const auditLogger = new InMemoryAuditLogger();

    await auditLogger.log({
      auditId: 'audit-1',
      actorId: 'admin-operator',
      action: 'INJECT_FAULT',
      targetType: 'DEPENDENCY',
      targetId: 'mongodb',
      payload: {
        faultType: 'MONGODB_UNAVAILABLE',
        ttlSeconds: 60,
      },
    });

    await auditLogger.log({
      auditId: 'audit-2',
      actorId: 'admin-operator',
      action: 'DISARM_FAULT',
      targetType: 'DEPENDENCY',
      targetId: 'mongodb',
      payload: {
        reason: 'experiment_complete',
      },
    });

    const recent = await auditLogger.listRecent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.action).toBe('DISARM_FAULT'); // Most recent first
    expect(recent[1]?.action).toBe('INJECT_FAULT');

    const byTarget = await auditLogger.listByTarget('DEPENDENCY', 'mongodb');
    expect(byTarget).toHaveLength(2);
  });
});
