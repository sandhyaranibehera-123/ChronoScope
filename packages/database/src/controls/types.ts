/**
 * Worker Controls and Control Commands Contracts — system-guarantees.md Rule 18 & ADR-006.
 *
 * Rule 18:
 * NATS carries two structurally distinct things:
 * 1. durable desired-state (worker_controls, OCC-versioned)
 * 2. durable one-shot commands (control_commands, full state machine, idempotent by command_id,
 *    two-phase cancellation via CANCELLATION_REQUESTED)
 * Both reside authoritatively in MySQL chronoscope_ops. NATS is transport only.
 */

export type WorkerControlStatus = 'ACTIVE' | 'PAUSED' | 'DRAINING';

export interface WorkerControlRecord {
  controlTarget: string;
  status: WorkerControlStatus;
  concurrency: number;
  config: Record<string, unknown> | null;
  version: number;
  updatedBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export type ControlCommandStatus =
  'PENDING' | 'EXECUTING' | 'COMPLETED' | 'CANCELLATION_REQUESTED' | 'CANCELLED' | 'FAILED';

export interface ControlCommandRecord {
  commandId: string;
  commandType: string;
  targetWorker: string;
  payload: Record<string, unknown>;
  status: ControlCommandStatus;
  issuedBy: string;
  resultPayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
  attemptCount: number;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SetDesiredStateOptions {
  status?: WorkerControlStatus | undefined;
  concurrency?: number | undefined;
  config?: Record<string, unknown> | null | undefined;
  expectedVersion: number;
  updatedBy?: string | undefined;
}

export interface CreateControlCommandOptions {
  commandId?: string | undefined;
  commandType: string;
  targetWorker: string;
  payload: Record<string, unknown>;
  issuedBy?: string | undefined;
}

export interface IWorkerControlManager {
  get(controlTarget: string): Promise<WorkerControlRecord | null>;
  list(): Promise<WorkerControlRecord[]>;
  setDesiredState(
    controlTarget: string,
    options: SetDesiredStateOptions,
  ): Promise<WorkerControlRecord>;
  initTarget(
    controlTarget: string,
    initial?: Partial<WorkerControlRecord>,
  ): Promise<WorkerControlRecord>;
}

export interface IControlCommandManager {
  issueCommand(
    options: CreateControlCommandOptions,
  ): Promise<{ command: ControlCommandRecord; isNew: boolean }>;
  getCommandById(commandId: string): Promise<ControlCommandRecord | null>;
  markExecuting(commandId: string, acknowledgedBy: string): Promise<ControlCommandRecord>;
  markCompleted(
    commandId: string,
    resultPayload?: Record<string, unknown>,
  ): Promise<ControlCommandRecord>;
  requestCancellation(commandId: string): Promise<ControlCommandRecord>;
  markCancelled(commandId: string, reason?: string): Promise<ControlCommandRecord>;
  markFailed(commandId: string, errorMessage: string): Promise<ControlCommandRecord>;
  getPendingCommands(limit?: number): Promise<ControlCommandRecord[]>;
  listRecentCommands(limit?: number): Promise<ControlCommandRecord[]>;
}
