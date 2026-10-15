import type { IControlCommandManager, ControlCommandRecord } from '@chronoscope/database';
import { createLogger } from '@chronoscope/observability';
import type { ControlDispatcher } from './control-dispatcher.js';

const logger = createLogger({ name: 'control-reconciler' });

export interface ControlReconcilerOptions {
  pollIntervalMs?: number;
  batchSize?: number;
}

export interface ReconcileResult {
  reconciledCount: number;
  commands: ControlCommandRecord[];
}

export class ControlReconciler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isReconciling = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly commandManager: IControlCommandManager,
    private readonly dispatcher: ControlDispatcher,
    options?: ControlReconcilerOptions,
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 5000;
    this.batchSize = options?.batchSize ?? 50;
  }

  public async reconcileBatch(): Promise<ReconcileResult> {
    if (this.isReconciling) {
      return { reconciledCount: 0, commands: [] };
    }

    this.isReconciling = true;
    try {
      // 1. Fetch pending or cancellation-requested commands from MySQL (Rule 18)
      const pendingCommands = await this.commandManager.getPendingCommands(this.batchSize);

      if (pendingCommands.length === 0) {
        return { reconciledCount: 0, commands: [] };
      }

      logger.info(
        { count: pendingCommands.length },
        'Reconciling pending control commands from MySQL to NATS',
      );

      const reconciled: ControlCommandRecord[] = [];

      for (const cmd of pendingCommands) {
        if (cmd.status === 'PENDING') {
          await this.dispatcher.publishControlCommand(cmd);
          reconciled.push(cmd);
        } else if (cmd.status === 'CANCELLATION_REQUESTED') {
          await this.dispatcher.publishCancellation(
            cmd.commandId,
            'Reconciled cancellation request',
          );
          reconciled.push(cmd);
        }
      }

      return {
        reconciledCount: reconciled.length,
        commands: reconciled,
      };
    } catch (err) {
      logger.error({ err }, 'Error during control commands reconciliation loop');
      return { reconciledCount: 0, commands: [] };
    } finally {
      this.isReconciling = false;
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.timer = setInterval(() => {
      void this.reconcileBatch();
    }, this.pollIntervalMs);

    logger.info({ intervalMs: this.pollIntervalMs }, 'ControlReconciler started');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('ControlReconciler stopped');
  }
}
