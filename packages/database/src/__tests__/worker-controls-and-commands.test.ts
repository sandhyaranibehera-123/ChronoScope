import { describe, expect, it } from 'vitest';
import { ConcurrencyConflictError, PreconditionFailedError } from '@chronoscope/domain';
import {
  InMemoryWorkerControlManager,
  InMemoryControlCommandManager,
} from '../controls/in-memory-control-managers.js';

describe('Worker Controls & Control Commands (Rule 18 & ADR-006)', () => {
  describe('Worker Controls (OCC-Versioned Desired-State)', () => {
    it('initializes a target and handles OCC updates correctly', async () => {
      const manager = new InMemoryWorkerControlManager();

      const control = await manager.initTarget('projection_worker', {
        status: 'ACTIVE',
        concurrency: 2,
      });

      expect(control.controlTarget).toBe('projection_worker');
      expect(control.status).toBe('ACTIVE');
      expect(control.version).toBe(1);
      expect(control.concurrency).toBe(2);

      // OCC update with matching expectedVersion: 1 -> 2
      const updated = await manager.setDesiredState('projection_worker', {
        status: 'PAUSED',
        expectedVersion: 1,
        updatedBy: 'test-operator',
      });

      expect(updated.status).toBe('PAUSED');
      expect(updated.version).toBe(2);
      expect(updated.updatedBy).toBe('test-operator');

      // Stale update with version 1 must throw ConcurrencyConflictError
      await expect(
        manager.setDesiredState('projection_worker', {
          status: 'ACTIVE',
          expectedVersion: 1,
        }),
      ).rejects.toThrow(ConcurrencyConflictError);

      // Successful update with matching version 2 -> 3
      const resumed = await manager.setDesiredState('projection_worker', {
        status: 'ACTIVE',
        expectedVersion: 2,
      });
      expect(resumed.status).toBe('ACTIVE');
      expect(resumed.version).toBe(3);
    });

    it('lists all initialized worker control records', async () => {
      const manager = new InMemoryWorkerControlManager();
      await manager.initTarget('worker_a');
      await manager.initTarget('worker_b');

      const list = await manager.list();
      expect(list).toHaveLength(2);
      expect(list.map((r) => r.controlTarget)).toEqual(['worker_a', 'worker_b']);
    });
  });

  describe('Control Commands (One-Shot Commands & Two-Phase Cancellation)', () => {
    it('creates command and deduplicates by command_id (Rule 18 & 8 idempotency)', async () => {
      const manager = new InMemoryControlCommandManager();

      const first = await manager.issueCommand({
        commandId: 'cmd-test-1',
        commandType: 'PAUSE_WORKER',
        targetWorker: 'projection_worker',
        payload: { reason: 'routine maintenance' },
      });

      expect(first.isNew).toBe(true);
      expect(first.command.status).toBe('PENDING');
      expect(first.command.commandType).toBe('PAUSE_WORKER');

      // Duplicate command_id
      const second = await manager.issueCommand({
        commandId: 'cmd-test-1',
        commandType: 'PAUSE_WORKER',
        targetWorker: 'projection_worker',
        payload: { reason: 'routine maintenance' },
      });

      expect(second.isNew).toBe(false);
      expect(second.command.commandId).toBe('cmd-test-1');
    });

    it('progresses through execution lifecycle to COMPLETED', async () => {
      const manager = new InMemoryControlCommandManager();
      const { command } = await manager.issueCommand({
        commandType: 'REBUILD_PROJECTION',
        targetWorker: 'order_projection',
        payload: { projection: 'order_summary' },
      });

      const executing = await manager.markExecuting(command.commandId, 'worker-pod-1');
      expect(executing.status).toBe('EXECUTING');
      expect(executing.acknowledgedBy).toBe('worker-pod-1');
      expect(executing.attemptCount).toBe(1);

      const completed = await manager.markCompleted(command.commandId, {
        documentsProcessed: 42,
      });
      expect(completed.status).toBe('COMPLETED');
      expect(completed.resultPayload).toEqual({ documentsProcessed: 42 });
      expect(completed.completedAt).toBeDefined();
    });

    it('supports two-phase cancellation: CANCELLATION_REQUESTED -> CANCELLED', async () => {
      const manager = new InMemoryControlCommandManager();
      const { command } = await manager.issueCommand({
        commandType: 'LONG_RUNNING_CHAOS',
        targetWorker: 'chaos_agent',
        payload: { durationSeconds: 600 },
      });

      await manager.markExecuting(command.commandId, 'agent-1');

      // Phase 1: Request cancellation
      const cancelling = await manager.requestCancellation(command.commandId);
      expect(cancelling.status).toBe('CANCELLATION_REQUESTED');

      // Phase 2: Worker acknowledges cancellation and records cleanup
      const cancelled = await manager.markCancelled(command.commandId, 'Cancelled by operator');
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.errorMessage).toBe('Cancelled by operator');
      expect(cancelled.completedAt).toBeDefined();

      // Attempting to cancel already-cancelled command throws PreconditionFailedError
      await expect(manager.requestCancellation(command.commandId)).rejects.toThrow(
        PreconditionFailedError,
      );
    });

    it('returns pending commands for reconciler polling', async () => {
      const manager = new InMemoryControlCommandManager();
      await manager.issueCommand({
        commandId: 'pending-1',
        commandType: 'DRAIN',
        targetWorker: 'worker',
        payload: {},
      });
      await manager.issueCommand({
        commandId: 'pending-2',
        commandType: 'PAUSE',
        targetWorker: 'worker',
        payload: {},
      });

      const pending = await manager.getPendingCommands();
      expect(pending).toHaveLength(2);
      expect(pending.map((p) => p.commandId)).toEqual(['pending-1', 'pending-2']);
    });
  });
});
