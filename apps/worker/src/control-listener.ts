import type {
  IWorkerControlManager,
  IControlCommandManager,
  WorkerControlRecord,
  ControlCommandRecord,
  WorkerControlStatus,
} from '@chronoscope/database';
import type { INatsClient, NatsSubscription } from '@chronoscope/messaging';
import { NATS_SUBJECTS } from '@chronoscope/messaging';
import { createLogger } from '@chronoscope/observability';

const logger = createLogger({ name: 'worker-control-listener' });

export type CommandHandler = (
  command: ControlCommandRecord,
  isCancelled: () => boolean,
) => Promise<Record<string, unknown> | void>;

export interface WorkerControlListenerOptions {
  workerId?: string;
  target?: string;
}

export class WorkerControlListener {
  private readonly workerId: string;
  private readonly target: string;
  private readonly subscriptions: NatsSubscription[] = [];
  private readonly commandHandlers = new Map<string, CommandHandler>();
  private readonly activeCancellations = new Set<string>();

  private currentStatus: WorkerControlStatus = 'ACTIVE';
  private currentConcurrency: number = 1;
  private currentVersion: number = 1;

  constructor(
    private readonly workerControlManager: IWorkerControlManager,
    private readonly commandManager: IControlCommandManager,
    private readonly natsClient: INatsClient,
    options?: WorkerControlListenerOptions,
  ) {
    this.workerId = options?.workerId ?? `worker-${process.pid}`;
    this.target = options?.target ?? 'worker';
  }

  public registerCommandHandler(commandType: string, handler: CommandHandler): void {
    this.commandHandlers.set(commandType, handler);
  }

  public async start(): Promise<void> {
    logger.info(
      { workerId: this.workerId, target: this.target },
      'Starting WorkerControlListener...',
    );

    // 1. Authoritative MySQL bootstrap (Rule 18: MySQL is source of truth, NATS is transport only)
    const existing = await this.workerControlManager.get(this.target);
    if (existing) {
      this.currentStatus = existing.status;
      this.currentConcurrency = existing.concurrency;
      this.currentVersion = existing.version;
    } else {
      const initialized = await this.workerControlManager.initTarget(this.target, {
        status: 'ACTIVE',
        concurrency: 1,
        updatedBy: 'system',
      });
      this.currentStatus = initialized.status;
      this.currentConcurrency = initialized.concurrency;
      this.currentVersion = initialized.version;
    }

    logger.info(
      {
        status: this.currentStatus,
        version: this.currentVersion,
        concurrency: this.currentConcurrency,
      },
      'Initialized worker control state from MySQL',
    );

    // 2. Subscribe to desired-state updates for target and broadcast (*)
    const stateSub = this.natsClient.subscribe<WorkerControlRecord>(
      NATS_SUBJECTS.workerState(this.target),
      (msg) => {
        this.handleDesiredStateNotification(msg.data);
      },
    );
    this.subscriptions.push(stateSub);

    // 3. Subscribe to one-shot commands for target
    const cmdSub = this.natsClient.subscribe<ControlCommandRecord>(
      NATS_SUBJECTS.workerCommands(this.target),
      async (msg) => {
        await this.handleCommandNotification(msg.data);
      },
    );
    this.subscriptions.push(cmdSub);

    // 4. Subscribe to broadcast commands (if target is not already 'all')
    if (this.target !== 'all') {
      const broadcastSub = this.natsClient.subscribe<ControlCommandRecord>(
        NATS_SUBJECTS.workerCommands('all'),
        async (msg) => {
          await this.handleCommandNotification(msg.data);
        },
      );
      this.subscriptions.push(broadcastSub);
    }

    // 5. Subscribe to command cancellations
    const cancelSub = this.natsClient.subscribe<{ commandId: string }>(
      'chronoscope.control.cancellations.*',
      (msg) => {
        if (msg.data.commandId) {
          this.activeCancellations.add(msg.data.commandId);
        }
      },
    );
    this.subscriptions.push(cancelSub);
  }

  public stop(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions.length = 0;
    logger.info('WorkerControlListener stopped');
  }

  public getStatus(): WorkerControlStatus {
    return this.currentStatus;
  }

  public getConcurrency(): number {
    return this.currentConcurrency;
  }

  public getVersion(): number {
    return this.currentVersion;
  }

  private handleDesiredStateNotification(data: WorkerControlRecord): void {
    if (!data || data.version <= this.currentVersion) {
      return; // Ignore stale or out-of-order transport messages (Rule 18 OCC)
    }

    logger.info(
      { previousStatus: this.currentStatus, newStatus: data.status, newVersion: data.version },
      'Applying updated worker desired state from NATS notification',
    );

    this.currentStatus = data.status;
    this.currentConcurrency = data.concurrency;
    this.currentVersion = data.version;
  }

  private async handleCommandNotification(data: ControlCommandRecord): Promise<void> {
    if (!data || !data.commandId) return;

    // Verify authoritative command status from MySQL
    const current = await this.commandManager.getCommandById(data.commandId);
    if (!current) {
      logger.warn(
        { commandId: data.commandId },
        'Received NATS command notification but not found in MySQL',
      );
      return;
    }

    if (current.status !== 'PENDING') {
      logger.info(
        { commandId: data.commandId, status: current.status },
        'Command is not in PENDING state; skipping execution',
      );
      return;
    }

    // Step 1: Mark executing in MySQL
    const executing = await this.commandManager.markExecuting(data.commandId, this.workerId);
    if (executing.status !== 'EXECUTING' || executing.acknowledgedBy !== this.workerId) {
      logger.info(
        {
          commandId: data.commandId,
          status: executing.status,
          acknowledgedBy: executing.acknowledgedBy,
        },
        'Command was claimed by another execution; skipping',
      );
      return;
    }

    const handler = this.commandHandlers.get(data.commandType);
    if (!handler) {
      await this.commandManager.markFailed(
        data.commandId,
        `No registered handler for commandType '${data.commandType}' on target '${this.target}'`,
      );
      return;
    }

    const isCancelled = (): boolean => {
      return this.activeCancellations.has(data.commandId);
    };

    try {
      if (isCancelled()) {
        await this.commandManager.markCancelled(data.commandId, 'Cancelled before execution start');
        return;
      }

      const result = await handler(data, isCancelled);

      if (isCancelled()) {
        await this.commandManager.markCancelled(data.commandId, 'Cancelled during execution');
        return;
      }

      await this.commandManager.markCompleted(
        data.commandId,
        (result as Record<string, unknown>) ?? undefined,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.commandManager.markFailed(data.commandId, errorMessage);
    } finally {
      this.activeCancellations.delete(data.commandId);
    }
  }
}
