import { describe, expect, it } from 'vitest';
import { InMemoryControlCommandManager } from '@chronoscope/database';
import { InMemoryNatsClient, matchesNatsSubject } from '../nats/in-memory-nats.js';
import { NATS_SUBJECTS } from '../nats/types.js';
import { ControlDispatcher } from '../controls/control-dispatcher.js';
import { ControlReconciler } from '../controls/control-reconciler.js';

describe('NATS Control Plane Transport & Reconciler (Rule 18 & ADR-006)', () => {
  it('matches NATS subject wildcards accurately', () => {
    // Exact match
    expect(matchesNatsSubject('a.b.c', 'a.b.c')).toBe(true);
    expect(matchesNatsSubject('a.b.c', 'a.b.d')).toBe(false);

    // Single token wildcard *
    expect(
      matchesNatsSubject('chronoscope.control.commands.*', 'chronoscope.control.commands.worker'),
    ).toBe(true);
    expect(
      matchesNatsSubject(
        'chronoscope.control.commands.*',
        'chronoscope.control.commands.worker.sub',
      ),
    ).toBe(false);
    expect(matchesNatsSubject('*.control.commands', 'chronoscope.control.commands')).toBe(true);

    // Multi token wildcard >
    expect(matchesNatsSubject('chronoscope.control.>', 'chronoscope.control.state.worker')).toBe(
      true,
    );
    expect(
      matchesNatsSubject('chronoscope.control.>', 'chronoscope.control.commands.worker.nested'),
    ).toBe(true);
  });

  it('delivers messages to matching subscribers and respects unsubscriptions', async () => {
    const nats = new InMemoryNatsClient();
    await nats.connect();

    const received: string[] = [];
    const sub = nats.subscribe<{ message: string }>('chronoscope.control.commands.*', (msg) => {
      received.push(msg.data.message);
    });

    await nats.publish('chronoscope.control.commands.worker', { message: 'hello worker' });
    expect(received).toEqual(['hello worker']);

    // Unsubscribe
    sub.unsubscribe();
    await nats.publish('chronoscope.control.commands.worker', { message: 'ignored message' });
    expect(received).toEqual(['hello worker']);
  });

  it('simulates packet loss and drops delivery to subscribers', async () => {
    const nats = new InMemoryNatsClient();
    let delivered = false;

    nats.subscribe('chronoscope.control.commands.*', () => {
      delivered = true;
    });

    // Drop all packets matching subject
    nats.simulatePacketLoss((subject) => subject.startsWith('chronoscope.control'));

    await nats.publish('chronoscope.control.commands.worker', { test: true });
    expect(delivered).toBe(false);

    // Clear packet loss
    nats.clearPacketLoss();
    await nats.publish('chronoscope.control.commands.worker', { test: true });
    expect(delivered).toBe(true);
  });

  it('ControlDispatcher publishes desired-state, commands, and cancellations to standardized subjects', async () => {
    const nats = new InMemoryNatsClient();
    const dispatcher = new ControlDispatcher(nats);

    let stateMsg: unknown = null;
    let cmdMsg: unknown = null;
    let cancelMsg: unknown = null;

    nats.subscribe(NATS_SUBJECTS.workerState('projection_worker'), (msg) => {
      stateMsg = msg.data;
    });
    nats.subscribe(NATS_SUBJECTS.workerCommands('worker'), (msg) => {
      cmdMsg = msg.data;
    });
    nats.subscribe(NATS_SUBJECTS.cancellation('cmd-123'), (msg) => {
      cancelMsg = msg.data;
    });

    await dispatcher.publishWorkerDesiredState({
      controlTarget: 'projection_worker',
      status: 'PAUSED',
      concurrency: 4,
      config: { bufferSize: 100 },
      version: 2,
      updatedBy: 'operator',
      updatedAt: new Date().toISOString(),
    });

    await dispatcher.publishControlCommand({
      commandId: 'cmd-999',
      commandType: 'DRAIN',
      targetWorker: 'worker',
      payload: { timeout: 30 },
      status: 'PENDING',
      issuedBy: 'operator',
      attemptCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await dispatcher.publishCancellation('cmd-123', 'Testing cancellation');

    expect(stateMsg).toMatchObject({
      controlTarget: 'projection_worker',
      status: 'PAUSED',
      version: 2,
    });
    expect(cmdMsg).toMatchObject({
      commandId: 'cmd-999',
      commandType: 'DRAIN',
      targetWorker: 'worker',
    });
    expect(cancelMsg).toMatchObject({
      commandId: 'cmd-123',
      reason: 'Testing cancellation',
    });
  });

  it('ControlReconciler recovers dropped NATS notifications from MySQL (Failure Matrix row 15 & ADR-006)', async () => {
    const nats = new InMemoryNatsClient();
    const commandManager = new InMemoryControlCommandManager();
    const dispatcher = new ControlDispatcher(nats);
    const reconciler = new ControlReconciler(commandManager, dispatcher);

    const receivedCommands: string[] = [];
    nats.subscribe<{ commandId: string }>('chronoscope.control.commands.*', (msg) => {
      receivedCommands.push(msg.data.commandId);
    });

    // 1. Issue command to MySQL
    const { command } = await commandManager.issueCommand({
      commandType: 'REBUILD_PROJECTION',
      targetWorker: 'worker',
      payload: { projection: 'order_summary' },
    });

    // 2. Simulate NATS transport failure dropping the initial publish
    nats.simulatePacketLoss(() => true);
    await dispatcher.publishControlCommand(command);
    expect(receivedCommands).toHaveLength(0); // Message was dropped by transport!

    // 3. Transport restores, Reconciler polls MySQL and re-notifies subscribers
    nats.clearPacketLoss();
    const result = await reconciler.reconcileBatch();

    expect(result.reconciledCount).toBe(1);
    expect(receivedCommands).toEqual([command.commandId]);
  });
});
