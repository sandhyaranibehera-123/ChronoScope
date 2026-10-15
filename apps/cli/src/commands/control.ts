import type { Command } from 'commander';
import {
  getMysqlPool,
  MysqlWorkerControlManager,
  MysqlControlCommandManager,
  type WorkerControlStatus,
} from '@chronoscope/database';

export function registerControlCommand(program: Command): void {
  const controlCmd = program
    .command('control')
    .description('Manage worker desired-state and one-shot control commands (Rule 18 & ADR-006)');

  // 1. Worker desired-state subcommands
  const workerCmd = controlCmd
    .command('worker')
    .description('Manage OCC-versioned worker desired-state');

  workerCmd
    .command('get')
    .description('Get current desired state of a worker target')
    .argument('<target>', 'Worker target name (e.g. worker, projection_worker)')
    .action(async (target: string) => {
      const pool = getMysqlPool();
      try {
        const manager = new MysqlWorkerControlManager(pool);
        const record = await manager.get(target);
        if (!record) {
          console.error(`Worker target '${target}' not found.`);
          process.exitCode = 1;
          return;
        }

        console.log(`Worker Desired State: ${record.controlTarget}`);
        console.log(`─`.repeat(40));
        console.log(`Status:      ${record.status}`);
        console.log(`Concurrency: ${record.concurrency}`);
        console.log(`Version:     ${record.version}`);
        console.log(`Updated By:  ${record.updatedBy}`);
        console.log(`Updated At:  ${record.updatedAt}`);
        console.log(`Config:      ${JSON.stringify(record.config ?? {})}`);
      } catch (err) {
        console.error(
          'Failed to get worker control state:',
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  workerCmd
    .command('set')
    .description('Update desired state for a worker target using OCC version matching')
    .argument('<target>', 'Worker target name')
    .requiredOption('--version <n>', 'Expected current version (OCC guard)')
    .option('--status <status>', 'ACTIVE | PAUSED | DRAINING')
    .option('--concurrency <n>', 'Concurrency limit')
    .option('--config <json>', 'JSON configuration override')
    .action(async (target: string, options) => {
      const pool = getMysqlPool();
      try {
        const manager = new MysqlWorkerControlManager(pool);

        let parsedConfig: Record<string, unknown> | undefined;
        if (options.config) {
          try {
            parsedConfig = JSON.parse(options.config);
          } catch {
            console.error('Invalid JSON configuration provided.');
            process.exitCode = 1;
            return;
          }
        }

        const updated = await manager.setDesiredState(target, {
          expectedVersion: Number(options.version),
          status: options.status as WorkerControlStatus | undefined,
          concurrency: options.concurrency ? Number(options.concurrency) : undefined,
          config: parsedConfig,
          updatedBy: 'cli-operator',
        });

        console.log(`Worker Desired State Updated Successfully:`);
        console.log(`─`.repeat(40));
        console.log(`Target:      ${updated.controlTarget}`);
        console.log(`New Status:  ${updated.status}`);
        console.log(`New Version: ${updated.version}`);
        console.log(`Concurrency: ${updated.concurrency}`);
      } catch (err) {
        console.error(
          'Failed to update worker control state:',
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  // 2. Control commands subcommands
  const commandCmd = controlCmd
    .command('command')
    .description('Issue and manage durable one-shot control commands');

  commandCmd
    .command('issue')
    .description('Issue a one-shot control command (idempotent by command ID)')
    .requiredOption(
      '--type <type>',
      'Command type (e.g. PAUSE_WORKER, RESUME_WORKER, DRAIN_WORKER)',
    )
    .requiredOption('--target <target>', 'Target worker name')
    .option('--id <id>', 'Optional explicit command UUID')
    .option('--payload <json>', 'JSON string payload', '{}')
    .action(async (options) => {
      const pool = getMysqlPool();
      try {
        const manager = new MysqlControlCommandManager(pool);

        let parsedPayload: Record<string, unknown> = {};
        try {
          parsedPayload = JSON.parse(options.payload);
        } catch {
          console.error('Invalid JSON payload provided.');
          process.exitCode = 1;
          return;
        }

        const result = await manager.issueCommand({
          commandId: options.id,
          commandType: options.type,
          targetWorker: options.target,
          payload: parsedPayload,
          issuedBy: 'cli-operator',
        });

        console.log(`Control Command Issued:`);
        console.log(`─`.repeat(40));
        console.log(`Command ID:   ${result.command.commandId}`);
        console.log(`Command Type: ${result.command.commandType}`);
        console.log(`Target:       ${result.command.targetWorker}`);
        console.log(`Status:       ${result.command.status}`);
        console.log(
          `Is New:       ${result.isNew ? 'YES (Created)' : 'NO (Idempotent Duplicate)'}`,
        );
      } catch (err) {
        console.error(
          'Failed to issue control command:',
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  commandCmd
    .command('status')
    .description('Check the status of a control command')
    .requiredOption('--id <id>', 'Command ID')
    .action(async (options) => {
      const pool = getMysqlPool();
      try {
        const manager = new MysqlControlCommandManager(pool);
        const cmd = await manager.getCommandById(options.id);
        if (!cmd) {
          console.error(`Control command '${options.id}' not found.`);
          process.exitCode = 1;
          return;
        }

        console.log(`Control Command Status: ${cmd.commandId}`);
        console.log(`─`.repeat(40));
        console.log(`Type:         ${cmd.commandType}`);
        console.log(`Target:       ${cmd.targetWorker}`);
        console.log(`Status:       ${cmd.status}`);
        console.log(`Issued By:    ${cmd.issuedBy}`);
        console.log(`Result:       ${JSON.stringify(cmd.resultPayload ?? {})}`);
        console.log(`Error:        ${cmd.errorMessage ?? '(none)'}`);
        console.log(`Created At:   ${cmd.createdAt}`);
        console.log(`Completed At: ${cmd.completedAt ?? '(in progress)'}`);
      } catch (err) {
        console.error(
          'Failed to get command status:',
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  commandCmd
    .command('cancel')
    .description('Request two-phase cancellation for an active command')
    .requiredOption('--id <id>', 'Command ID')
    .action(async (options) => {
      const pool = getMysqlPool();
      try {
        const manager = new MysqlControlCommandManager(pool);
        const cancelled = await manager.requestCancellation(options.id);

        console.log(`Command Cancellation Requested:`);
        console.log(`─`.repeat(40));
        console.log(`Command ID:   ${cancelled.commandId}`);
        console.log(`Status:       ${cancelled.status}`);
      } catch (err) {
        console.error(
          'Failed to cancel command:',
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  commandCmd
    .command('list')
    .description('List recent control commands')
    .option('--limit <n>', 'Maximum commands to return', '20')
    .action(async (options) => {
      const pool = getMysqlPool();
      try {
        const manager = new MysqlControlCommandManager(pool);
        const commands = await manager.listRecentCommands(Number(options.limit));

        console.log(`Recent Control Commands (${commands.length} items):`);
        console.log(`─`.repeat(60));
        for (const c of commands) {
          const statusPad = c.status.padEnd(22);
          const typePad = c.commandType.padEnd(20);
          console.log(`[${statusPad}] ${typePad} | ID: ${c.commandId} | Target: ${c.targetWorker}`);
        }
      } catch (err) {
        console.error(
          'Failed to list control commands:',
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });
}
