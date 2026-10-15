import type { Command } from 'commander';
import chalk from 'chalk';
import { ChaosEngine, type FaultType, type FaultLayer } from '@chronoscope/chaos';
import { getMysqlPool, MysqlAuditLogger } from '@chronoscope/database';

let sharedEngine: ChaosEngine | null = null;

function getSharedEngine(): ChaosEngine {
  if (!sharedEngine) {
    const isChaos = process.env['CHAOS_MODE'] === 'true';
    let auditLogger: MysqlAuditLogger | undefined;
    try {
      const pool = getMysqlPool();
      auditLogger = new MysqlAuditLogger(pool);
    } catch {
      // Offline fallback
    }
    sharedEngine = new ChaosEngine({
      chaosEnabled: isChaos,
      auditLogger,
    });
  }
  return sharedEngine;
}

export function registerChaosCommand(program: Command): void {
  const chaosCmd = program
    .command('chaos')
    .description('Chaos Engineering & Fault Injection (Phase 11, Rule 21)');

  chaosCmd
    .command('inject')
    .description(
      'Inject a typed chaos fault (Rule 21: requires CHAOS_MODE=true and admin authorization)',
    )
    .requiredOption(
      '--type <type>',
      'Fault type (e.g. MONGODB_UNAVAILABLE, MYSQL_UNAVAILABLE, LATENCY, EXCEPTION)',
    )
    .requiredOption('--layer <layer>', 'Fault layer: APPLICATION | DEPENDENCY | INFRASTRUCTURE')
    .requiredOption(
      '--target <target>',
      'Target component (e.g. mongodb, mysql, order-summary, api)',
    )
    .option('--latency <ms>', 'Artificial latency in milliseconds for LATENCY faults')
    .option('--error <message>', 'Custom error message for EXCEPTION faults')
    .option('--ttl <seconds>', 'Time-to-live auto-expiry in seconds (default: 60, max: 300)')
    .action(
      async (options: {
        type: string;
        layer: string;
        target: string;
        latency?: string;
        error?: string;
        ttl?: string;
      }) => {
        try {
          const engine = getSharedEngine();
          const latencyMs = options.latency ? Number.parseInt(options.latency, 10) : undefined;
          const ttlSeconds = options.ttl ? Number.parseInt(options.ttl, 10) : 60;

          const activeFault = await engine.inject(
            {
              layer: options.layer.toUpperCase() as FaultLayer,
              type: options.type.toUpperCase() as FaultType,
              target: options.target,
              parameters: {
                probability: 1,
                latencyMs,
                errorMessage: options.error,
              },
              ttlSeconds,
            },
            'admin',
            'cli-operator',
          );

          console.log(chalk.green(`✓ Chaos fault injected successfully (Rule 21)`));
          console.log(`  Fault ID:   ${chalk.cyan(activeFault.faultId)}`);
          console.log(`  Layer:      ${activeFault.layer}`);
          console.log(`  Type:       ${chalk.yellow(activeFault.type)}`);
          console.log(`  Target:     ${activeFault.target}`);
          console.log(`  Expires At: ${activeFault.expiresAt}`);
        } catch (error) {
          console.error(
            chalk.red(
              `✗ Failed to inject chaos fault: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
          process.exitCode = 1;
        }
      },
    );

  chaosCmd
    .command('list')
    .description('List all currently active chaos faults')
    .action(() => {
      const engine = getSharedEngine();
      const active = engine.getActiveFaults();

      if (active.length === 0) {
        console.log(chalk.gray('No active chaos faults. System is operating normally.'));
        return;
      }

      console.log(chalk.bold(`Active Chaos Faults (${active.length}):`));
      for (const fault of active) {
        console.log(
          `- [${chalk.yellow(fault.type)}] on ${chalk.cyan(fault.target)} (ID: ${fault.faultId}, Expires: ${fault.expiresAt})`,
        );
      }
    });

  chaosCmd
    .command('disarm')
    .description('Disarm an active chaos fault')
    .requiredOption('--id <fault-id>', 'Fault ID to disarm')
    .action(async (options: { id: string }) => {
      try {
        const engine = getSharedEngine();
        await engine.disarm(options.id, 'admin', 'cli-operator');
        console.log(chalk.green(`✓ Disarmed chaos fault ${options.id}`));
      } catch (error) {
        console.error(
          chalk.red(
            `✗ Failed to disarm fault: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    });

  chaosCmd
    .command('kill-switch')
    .description('EMERGENCY KILL SWITCH: Immediately disarm ALL active chaos faults (Rule 21)')
    .action(async () => {
      try {
        const engine = getSharedEngine();
        const response = await engine.disarmAll('admin', 'cli-operator');
        console.log(
          chalk.green.bold(`✓ KILL SWITCH ACTIVATED: Disarmed ${response.disarmedCount} fault(s)`),
        );
      } catch (error) {
        console.error(
          chalk.red(
            `✗ Kill switch failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    });
}
