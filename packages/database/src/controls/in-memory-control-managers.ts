import { randomUUID } from 'node:crypto';
import {
  ConcurrencyConflictError,
  NotFoundError,
  PreconditionFailedError,
} from '@chronoscope/domain';
import type {
  IWorkerControlManager,
  IControlCommandManager,
  WorkerControlRecord,
  ControlCommandRecord,
  SetDesiredStateOptions,
  CreateControlCommandOptions,
} from './types.js';

export class InMemoryWorkerControlManager implements IWorkerControlManager {
  private readonly records = new Map<string, WorkerControlRecord>();

  public async get(controlTarget: string): Promise<WorkerControlRecord | null> {
    const record = this.records.get(controlTarget);
    return record ? { ...record } : null;
  }

  public async list(): Promise<WorkerControlRecord[]> {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  public async initTarget(
    controlTarget: string,
    initial?: Partial<WorkerControlRecord>,
  ): Promise<WorkerControlRecord> {
    const existing = this.records.get(controlTarget);
    if (existing) {
      return { ...existing };
    }

    const now = new Date().toISOString();
    const record: WorkerControlRecord = {
      controlTarget,
      status: initial?.status ?? 'ACTIVE',
      concurrency: initial?.concurrency ?? 1,
      config: initial?.config ?? null,
      version: 1,
      updatedBy: initial?.updatedBy ?? 'system',
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(controlTarget, record);
    return { ...record };
  }

  public async setDesiredState(
    controlTarget: string,
    options: SetDesiredStateOptions,
  ): Promise<WorkerControlRecord> {
    const current = this.records.get(controlTarget);
    if (!current) {
      throw new NotFoundError(
        `Worker control target '${controlTarget}' not found`,
        'ERR_WORKER_CONTROL_NOT_FOUND',
        { controlTarget },
      );
    }

    if (current.version !== options.expectedVersion) {
      throw new ConcurrencyConflictError(
        `OCC version mismatch for worker control '${controlTarget}': expected version ${options.expectedVersion}, but current version is ${current.version}`,
        'ERR_WORKER_CONTROL_OCC_CONFLICT',
        {
          controlTarget,
          expectedVersion: options.expectedVersion,
          currentVersion: current.version,
        },
      );
    }

    const now = new Date().toISOString();
    const updated: WorkerControlRecord = {
      ...current,
      status: options.status ?? current.status,
      concurrency: options.concurrency ?? current.concurrency,
      config: options.config !== undefined ? options.config : current.config,
      version: current.version + 1,
      updatedBy: options.updatedBy ?? 'operator',
      updatedAt: now,
    };

    this.records.set(controlTarget, updated);
    return { ...updated };
  }

  public clear(): void {
    this.records.clear();
  }
}

export class InMemoryControlCommandManager implements IControlCommandManager {
  private readonly commands = new Map<string, ControlCommandRecord>();

  public async issueCommand(
    options: CreateControlCommandOptions,
  ): Promise<{ command: ControlCommandRecord; isNew: boolean }> {
    const commandId = options.commandId ?? randomUUID();

    const existing = this.commands.get(commandId);
    if (existing) {
      return { command: { ...existing }, isNew: false };
    }

    const now = new Date().toISOString();
    const command: ControlCommandRecord = {
      commandId,
      commandType: options.commandType,
      targetWorker: options.targetWorker,
      payload: options.payload,
      status: 'PENDING',
      issuedBy: options.issuedBy ?? 'operator',
      resultPayload: null,
      errorMessage: null,
      attemptCount: 0,
      acknowledgedBy: null,
      acknowledgedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.commands.set(commandId, command);
    return { command: { ...command }, isNew: true };
  }

  public async getCommandById(commandId: string): Promise<ControlCommandRecord | null> {
    const cmd = this.commands.get(commandId);
    return cmd ? { ...cmd } : null;
  }

  public async markExecuting(
    commandId: string,
    acknowledgedBy: string,
  ): Promise<ControlCommandRecord> {
    const current = this.commands.get(commandId);
    if (!current) {
      throw new NotFoundError(`Control command ${commandId} not found`);
    }

    // Atomic transition: only transition if current status is PENDING
    if (current.status !== 'PENDING') {
      return { ...current };
    }

    const now = new Date().toISOString();
    const updated: ControlCommandRecord = {
      ...current,
      status: 'EXECUTING',
      acknowledgedBy,
      acknowledgedAt: now,
      attemptCount: current.attemptCount + 1,
      updatedAt: now,
    };

    this.commands.set(commandId, updated);
    return { ...updated };
  }

  public async markCompleted(
    commandId: string,
    resultPayload?: Record<string, unknown>,
  ): Promise<ControlCommandRecord> {
    const current = this.commands.get(commandId);
    if (!current) {
      throw new NotFoundError(`Control command ${commandId} not found`);
    }

    const now = new Date().toISOString();
    const updated: ControlCommandRecord = {
      ...current,
      status: 'COMPLETED',
      resultPayload: resultPayload ?? null,
      completedAt: now,
      updatedAt: now,
    };

    this.commands.set(commandId, updated);
    return { ...updated };
  }

  public async requestCancellation(commandId: string): Promise<ControlCommandRecord> {
    const current = this.commands.get(commandId);
    if (!current) {
      throw new NotFoundError(`Control command ${commandId} not found`);
    }

    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(current.status)) {
      throw new PreconditionFailedError(
        `Cannot cancel command ${commandId} in terminal status '${current.status}'`,
      );
    }

    if (current.status === 'CANCELLATION_REQUESTED') {
      return { ...current };
    }

    const now = new Date().toISOString();
    const updated: ControlCommandRecord = {
      ...current,
      status: 'CANCELLATION_REQUESTED',
      updatedAt: now,
    };

    this.commands.set(commandId, updated);
    return { ...updated };
  }

  public async markCancelled(commandId: string, reason?: string): Promise<ControlCommandRecord> {
    const current = this.commands.get(commandId);
    if (!current) {
      throw new NotFoundError(`Control command ${commandId} not found`);
    }

    const now = new Date().toISOString();
    const updated: ControlCommandRecord = {
      ...current,
      status: 'CANCELLED',
      errorMessage: reason ?? null,
      completedAt: now,
      updatedAt: now,
    };

    this.commands.set(commandId, updated);
    return { ...updated };
  }

  public async markFailed(commandId: string, errorMessage: string): Promise<ControlCommandRecord> {
    const current = this.commands.get(commandId);
    if (!current) {
      throw new NotFoundError(`Control command ${commandId} not found`);
    }

    const now = new Date().toISOString();
    const updated: ControlCommandRecord = {
      ...current,
      status: 'FAILED',
      errorMessage,
      completedAt: now,
      updatedAt: now,
    };

    this.commands.set(commandId, updated);
    return { ...updated };
  }

  public async getPendingCommands(limit: number = 50): Promise<ControlCommandRecord[]> {
    return Array.from(this.commands.values())
      .filter((c) => c.status === 'PENDING' || c.status === 'CANCELLATION_REQUESTED')
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }

  public async listRecentCommands(limit: number = 50): Promise<ControlCommandRecord[]> {
    return Array.from(this.commands.values())
      .reverse()
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }

  public clear(): void {
    this.commands.clear();
  }
}
