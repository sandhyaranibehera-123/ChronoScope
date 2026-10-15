/**
 * NATS Control Plane Messaging Contracts — system-guarantees.md Rule 18 & ADR-006.
 *
 * NATS is transport only. It carries:
 * - Desired state notifications (worker_controls, OCC-versioned)
 * - One-shot commands (control_commands, idempotent by command_id)
 * Both reside authoritatively in MySQL first.
 */

export interface NatsMessage<T = unknown> {
  subject: string;
  data: T;
  timestamp: string;
  reply?: string | undefined;
}

export type NatsMessageHandler<T = unknown> = (msg: NatsMessage<T>) => void | Promise<void>;

export interface NatsSubscription {
  subject: string;
  unsubscribe(): void;
}

export interface INatsClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish<T = unknown>(subject: string, data: T): Promise<void>;
  subscribe<T = unknown>(subject: string, handler: NatsMessageHandler<T>): NatsSubscription;
}

export const NATS_SUBJECTS = {
  STATE_PREFIX: 'chronoscope.control.state',
  COMMANDS_PREFIX: 'chronoscope.control.commands',
  CANCELLATIONS_PREFIX: 'chronoscope.control.cancellations',

  workerState(target: string): string {
    return `chronoscope.control.state.${target}`;
  },

  allWorkerState(): string {
    return 'chronoscope.control.state.*';
  },

  workerCommands(target: string): string {
    return `chronoscope.control.commands.${target}`;
  },

  allCommands(): string {
    return 'chronoscope.control.commands.all';
  },

  cancellation(commandId: string): string {
    return `chronoscope.control.cancellations.${commandId}`;
  },
} as const;
