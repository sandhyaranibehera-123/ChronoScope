import { describe, expect, it } from 'vitest';
import { InMemoryWorkerControlManager, InMemoryControlCommandManager } from '@chronoscope/database';
import { InMemoryNatsClient, ControlDispatcher, ControlReconciler } from '@chronoscope/messaging';
import { ConcurrencyConflictError } from '@chronoscope/domain';
import { WorkerControlListener } from '../../apps/worker/src/control-listener.js';

describe('Golden Scenario: NATS Control Plane + Durable Desired-State & Commands (Phase 10, Rule 18 & ADR-006)', () => {
  it('demonstrates OCC-versioned desired-state management, notification, and stale write rejection (Rule 18)', async () => {
    const workerControlManager = new InMemoryWorkerControlManager();
    const commandManager = new InMemoryControlCommandManager();
    const nats = new InMemoryNatsClient();
    const dispatcher = new ControlDispatcher(nats);

    // 1. Initial worker state registered in MySQL chronoscope_ops.worker_controls (version 1)
    const initial = await workerControlManager.initTarget('worker', {
      status: 'ACTIVE',
      concurrency: 2,
    });
    expect(initial.version).toBe(1);
    expect(initial.status).toBe('ACTIVE');

    // 2. Worker starts and bootstraps state from authoritative MySQL (not waiting for NATS)
    const listener = new WorkerControlListener(workerControlManager, commandManager, nats, {
      workerId: 'worker-node-1',
      target: 'worker',
    });
    await listener.start();

    expect(listener.getStatus()).toBe('ACTIVE');
    expect(listener.getVersion()).toBe(1);

    // 3. Operator transitions desired-state: ACTIVE -> PAUSED with OCC version 1 -> 2
    const updated = await workerControlManager.setDesiredState('worker', {
      status: 'PAUSED',
      expectedVersion: 1,
      concurrency: 4,
      updatedBy: 'operator-alice',
    });
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('PAUSED');

    // 4. Dispatch notification over NATS transport
    await dispatcher.publishWorkerDesiredState(updated);

    // Allow event loop to process NATS microtask
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listener.getStatus()).toBe('PAUSED');
    expect(listener.getVersion()).toBe(2);
    expect(listener.getConcurrency()).toBe(4);

    // 5. Concurrency Conflict Proof: A racing operator attempting update with stale version 1 MUST be rejected
    await expect(
      workerControlManager.setDesiredState('worker', {
        status: 'ACTIVE',
        expectedVersion: 1, // Stale! Current version is 2
      }),
    ).rejects.toThrow(ConcurrencyConflictError);

    // Version remains 2 and state remains PAUSED
    const current = await workerControlManager.get('worker');
    expect(current?.version).toBe(2);
    expect(current?.status).toBe('PAUSED');

    listener.stop();
  });

  it('demonstrates durable one-shot command execution and at-most-once idempotency (Rule 18 & Rule 8)', async () => {
    const workerControlManager = new InMemoryWorkerControlManager();
    const commandManager = new InMemoryControlCommandManager();
    const nats = new InMemoryNatsClient();
    const dispatcher = new ControlDispatcher(nats);

    const listener = new WorkerControlListener(workerControlManager, commandManager, nats, {
      workerId: 'worker-node-2',
      target: 'worker',
    });

    let executionCount = 0;
    listener.registerCommandHandler('DRAIN_WORKER', async (cmd) => {
      executionCount++;
      return { drainedJobs: 5, target: cmd.targetWorker };
    });

    await listener.start();

    const commandId = '00000000-0000-0000-0000-000000000999';

    // 1. Issue command transactionally to MySQL chronoscope_ops.control_commands
    const firstIssue = await commandManager.issueCommand({
      commandId,
      commandType: 'DRAIN_WORKER',
      targetWorker: 'worker',
      payload: { timeoutSeconds: 30 },
    });
    expect(firstIssue.isNew).toBe(true);
    expect(firstIssue.command.status).toBe('PENDING');

    // 2. Dispatch to NATS
    await dispatcher.publishControlCommand(firstIssue.command);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(executionCount).toBe(1);

    // 3. Verify authoritative outcome recorded in MySQL
    const completed = await commandManager.getCommandById(commandId);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.attemptCount).toBe(1);
    expect(completed?.acknowledgedBy).toBe('worker-node-2');
    expect(completed?.resultPayload).toEqual({ drainedJobs: 5, target: 'worker' });

    // 4. Idempotency Proof (Rule 8 & 18): Re-issuing the exact same command_id deduplicates with zero re-execution
    const duplicateIssue = await commandManager.issueCommand({
      commandId,
      commandType: 'DRAIN_WORKER',
      targetWorker: 'worker',
      payload: { timeoutSeconds: 30 },
    });
    expect(duplicateIssue.isNew).toBe(false);
    expect(duplicateIssue.command.status).toBe('COMPLETED');

    // Deliver duplicate notification over NATS — worker must decline to re-execute
    await dispatcher.publishControlCommand(duplicateIssue.command);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(executionCount).toBe(1); // Still exactly 1!
    listener.stop();
  });

  it('demonstrates two-phase command cancellation: CANCELLATION_REQUESTED -> CANCELLED (Rule 18)', async () => {
    const workerControlManager = new InMemoryWorkerControlManager();
    const commandManager = new InMemoryControlCommandManager();
    const nats = new InMemoryNatsClient();
    const dispatcher = new ControlDispatcher(nats);

    const listener = new WorkerControlListener(workerControlManager, commandManager, nats, {
      workerId: 'worker-node-3',
      target: 'worker',
    });

    let cancellationDetected = false;
    listener.registerCommandHandler('LONG_RUNNING_JOB', async (cmd, isCancelled) => {
      // Simulate stepped execution checking cancellation between chunks
      for (let step = 0; step < 5; step++) {
        if (isCancelled()) {
          cancellationDetected = true;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });

    await listener.start();

    const commandId = '00000000-0000-0000-0000-000000000888';
    const { command } = await commandManager.issueCommand({
      commandId,
      commandType: 'LONG_RUNNING_JOB',
      targetWorker: 'worker',
      payload: { steps: 5 },
    });

    // Start execution asynchronously
    void dispatcher.publishControlCommand(command);
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Phase 1: Request cancellation via MySQL and publish to NATS
    const cancelling = await commandManager.requestCancellation(commandId);
    expect(cancelling.status).toBe('CANCELLATION_REQUESTED');
    await dispatcher.publishCancellation(commandId, 'Operator cancellation');

    // Wait for worker to detect cancellation and finalize
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(cancellationDetected).toBe(true);

    // Phase 2: Verify terminal status in MySQL is CANCELLED
    const cancelledRecord = await commandManager.getCommandById(commandId);
    expect(cancelledRecord?.status).toBe('CANCELLED');
    expect(cancelledRecord?.errorMessage).toContain('Cancelled');

    listener.stop();
  });

  it('demonstrates NATS message loss recovery via ControlReconciler (Failure Matrix row 15 & ADR-006)', async () => {
    const workerControlManager = new InMemoryWorkerControlManager();
    const commandManager = new InMemoryControlCommandManager();
    const nats = new InMemoryNatsClient();
    const dispatcher = new ControlDispatcher(nats);
    const reconciler = new ControlReconciler(commandManager, dispatcher, {
      pollIntervalMs: 50,
    });

    const listener = new WorkerControlListener(workerControlManager, commandManager, nats, {
      workerId: 'worker-node-reconciler',
      target: 'worker',
    });

    let executedCommandId: string | null = null;
    listener.registerCommandHandler('REBUILD_PROJECTION', async (cmd) => {
      executedCommandId = cmd.commandId;
      return { rebuilt: true };
    });

    await listener.start();

    // 1. Issue command to MySQL
    const commandId = '00000000-0000-0000-0000-000000000777';
    const { command } = await commandManager.issueCommand({
      commandId,
      commandType: 'REBUILD_PROJECTION',
      targetWorker: 'worker',
      payload: { projection: 'order_summary' },
    });

    // 2. Simulate NATS transport failure: drop the initial dispatch
    nats.simulatePacketLoss(() => true);
    await dispatcher.publishControlCommand(command);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Command was not delivered because NATS dropped the packet
    expect(executedCommandId).toBeNull();

    // 3. Transport recovers, ControlReconciler triggers reconciliation from MySQL
    nats.clearPacketLoss();
    const reconcileResult = await reconciler.reconcileBatch();
    expect(reconcileResult.reconciledCount).toBe(1);

    // Allow worker to receive re-notified message
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(executedCommandId).toBe(commandId);

    const completed = await commandManager.getCommandById(commandId);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.acknowledgedBy).toBe('worker-node-reconciler');

    listener.stop();
  });
});
