import { describe, expect, it } from 'vitest';
import { ChaosEngine } from '@chronoscope/chaos';
import { InMemoryAuditLogger } from '@chronoscope/database';
import { buildServer } from '../server.js';

describe('Chaos Routes (Phase 11, Rule 21)', () => {
  it('enforces safety gates: rejects injection when CHAOS_MODE is false', async () => {
    const auditLogger = new InMemoryAuditLogger();
    const chaosEngine = new ChaosEngine({
      chaosEnabled: false, // Chaos mode OFF
      auditLogger,
    });

    const app = await buildServer({ chaosEngine });
    const adminToken = app.jwt.sign({ role: 'admin', sub: 'admin-1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chaos/inject',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        layer: 'DEPENDENCY',
        type: 'MONGODB_UNAVAILABLE',
        target: 'mongodb',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain('Chaos mode is disabled');
  });

  it('enforces safety gates: rejects injection from non-admin role', async () => {
    const auditLogger = new InMemoryAuditLogger();
    const chaosEngine = new ChaosEngine({
      chaosEnabled: true,
      auditLogger,
    });

    const app = await buildServer({ chaosEngine });
    const viewerToken = app.jwt.sign({ role: 'viewer', sub: 'user-viewer' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chaos/inject',
      headers: {
        authorization: `Bearer ${viewerToken}`,
      },
      payload: {
        layer: 'DEPENDENCY',
        type: 'MONGODB_UNAVAILABLE',
        target: 'mongodb',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain('admin role authorization');
  });

  it('injects fault, lists active faults, and disarms via kill-switch (Rule 21)', async () => {
    const auditLogger = new InMemoryAuditLogger();
    const chaosEngine = new ChaosEngine({
      chaosEnabled: true,
      auditLogger,
    });

    const app = await buildServer({ chaosEngine });
    const adminToken = app.jwt.sign({ role: 'admin', sub: 'admin-alice' });

    // 1. Inject MONGODB_UNAVAILABLE fault
    const injectRes = await app.inject({
      method: 'POST',
      url: '/api/v1/chaos/inject',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        layer: 'DEPENDENCY',
        type: 'MONGODB_UNAVAILABLE',
        target: 'mongodb',
        ttlSeconds: 60,
      },
    });

    expect(injectRes.statusCode).toBe(201);
    const fault = injectRes.json();
    expect(fault.faultId).toBeDefined();
    expect(fault.type).toBe('MONGODB_UNAVAILABLE');
    expect(fault.target).toBe('mongodb');

    // 2. GET /api/v1/chaos/active
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/chaos/active',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().activeFaults).toHaveLength(1);
    expect(listRes.json().activeFaults[0].faultId).toBe(fault.faultId);

    // 3. POST /api/v1/chaos/kill-switch
    const killRes = await app.inject({
      method: 'POST',
      url: '/api/v1/chaos/kill-switch',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });
    expect(killRes.statusCode).toBe(200);
    expect(killRes.json().disarmedCount).toBe(1);
    expect(killRes.json().disarmedFaultIds).toContain(fault.faultId);

    // 4. Verify no active faults remain
    const afterKillList = await app.inject({
      method: 'GET',
      url: '/api/v1/chaos/active',
    });
    expect(afterKillList.json().activeFaults).toHaveLength(0);

    // 5. Verify audit logs were written
    const auditLogs = await auditLogger.listRecent(10);
    expect(auditLogs).toHaveLength(2); // INJECT_FAULT and ENGAGE_KILL_SWITCH
    expect(auditLogs[0]?.action).toBe('ENGAGE_KILL_SWITCH');
    expect(auditLogs[1]?.action).toBe('INJECT_FAULT');
  });
});
