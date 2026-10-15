import type {
  ActorId,
  AggregateId,
  CausationId,
  CommandId,
  CorrelationId,
  RequestId,
  TimelineId,
} from './id.js';
import type { DomainError } from './errors.js';
import type { DomainEvent } from './event.js';

/**
 * Explicit Command interface — system-guarantees.md rule 7:
 * "A command targets exactly one aggregate. 0, 1, or many events, all belonging to that aggregate —
 * never a multi-aggregate command. Cross-aggregate workflows are separate, orchestrator-coordinated commands."
 */
export interface Command<TPayload = unknown> {
  readonly command_id: CommandId | string;
  readonly request_id: RequestId | string;
  readonly correlation_id: CorrelationId | string;
  readonly causation_id: CausationId | string | null;
  readonly actor_id: ActorId | string;
  readonly timeline_id: TimelineId | string;
  readonly aggregate_id: AggregateId | string;
  readonly aggregate_type: string;
  readonly expected_sequence: number;
  readonly payload: TPayload;
}

export interface CommandSuccessResult<TState = unknown> {
  readonly success: true;
  readonly command_id: string;
  readonly aggregate_id: string;
  readonly timeline_id: string;
  readonly events: readonly DomainEvent[];
  readonly resulting_state: TState;
  readonly resulting_sequence: number;
}

export interface CommandFailureResult {
  readonly success: false;
  readonly command_id: string;
  readonly aggregate_id: string;
  readonly timeline_id: string;
  readonly error: DomainError;
}

export type CommandResult<TState = unknown> = CommandSuccessResult<TState> | CommandFailureResult;
