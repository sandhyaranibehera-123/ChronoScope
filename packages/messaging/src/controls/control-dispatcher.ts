import type { WorkerControlRecord, ControlCommandRecord } from '@chronoscope/database';
import { createLogger } from '@chronoscope/observability';
import type { INatsClient } from '../nats/types.js';
import { NATS_SUBJECTS } from '../nats/types.js';

const logger = createLogger({ name: 'control-dispatcher' });

export class ControlDispatcher {
  constructor(private readonly natsClient: INatsClient) {}

  public async publishWorkerDesiredState(record: WorkerControlRecord): Promise<void> {
    const subject = NATS_SUBJECTS.workerState(record.controlTarget);
    logger.info(
      { target: record.controlTarget, status: record.status, version: record.version },
      'Publishing worker desired-state update to NATS',
    );

    await this.natsClient.publish(subject, {
      controlTarget: record.controlTarget,
      status: record.status,
      concurrency: record.concurrency,
      config: record.config,
      version: record.version,
      updatedBy: record.updatedBy,
      updatedAt: record.updatedAt,
    });
  }

  public async publishControlCommand(command: ControlCommandRecord): Promise<void> {
    const subject = NATS_SUBJECTS.workerCommands(command.targetWorker);
    logger.info(
      {
        commandId: command.commandId,
        commandType: command.commandType,
        target: command.targetWorker,
      },
      'Publishing one-shot control command to NATS',
    );

    await this.natsClient.publish(subject, {
      commandId: command.commandId,
      commandType: command.commandType,
      targetWorker: command.targetWorker,
      payload: command.payload,
      issuedBy: command.issuedBy,
      status: command.status,
      createdAt: command.createdAt,
    });
  }

  public async publishCancellation(commandId: string, reason?: string): Promise<void> {
    const subject = NATS_SUBJECTS.cancellation(commandId);
    logger.info({ commandId, reason }, 'Publishing command cancellation to NATS');

    await this.natsClient.publish(subject, {
      commandId,
      reason,
      timestamp: new Date().toISOString(),
    });
  }
}
