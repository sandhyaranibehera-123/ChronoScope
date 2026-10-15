import type { Command } from 'commander';
import chalk from 'chalk';
import { rebuildProjectionCommand } from './rebuild-projection.js';

export const RECOVERY_PATHS = [
  {
    path: 1,
    name: 'API crash before MySQL commit',
    mechanism: 'Client retry with deterministic command_id',
    guarantee: 'Zero state change on failure; exactly-once application on retry (Rule 8 & 16)',
  },
  {
    path: 2,
    name: 'API crash after MySQL commit, before outbox publish',
    mechanism: 'Outbox lease worker scans PENDING records',
    guarantee: 'Durable outbox entry published to Kafka on worker restart (Rules 8 & 10)',
  },
  {
    path: 3,
    name: 'Outbox publisher crashes mid-lease',
    mechanism: 'Lease expiration reaper via SELECT ... FOR UPDATE SKIP LOCKED',
    guarantee: 'Expired LEASED rows reclaimed and safely republished (Rules 8 & 10)',
  },
  {
    path: 4,
    name: 'Kafka publish succeeds, lease-mark-published fails (At-Least-Once Delivery)',
    mechanism: 'MySQL chronoscope_ops.inbox deduplication',
    guarantee: 'Duplicate absorbed without duplicate application or corrupted read model (Rule 10)',
  },
  {
    path: 5,
    name: 'MongoDB document/collection lost after checkpoint advanced',
    mechanism: 'Deterministic projection rebuild from MySQL event store up to cutoff',
    guarantee:
      'Cold read-store recovery with 100% hash parity and sequence alignment (Rule 11, 17, 23)',
  },
  {
    path: 6,
    name: 'RabbitMQ worker crashes mid-job execution before SQL state commit',
    mechanism: 'RabbitMQ unacked redelivery + jobs.idempotency_key',
    guarantee: 'At-most-once persistent effect on downstream systems (Rule 8 & ADR-005)',
  },
  {
    path: 7,
    name: 'NATS control plane packet loss / message dropped',
    mechanism: 'MySQL chronoscope_ops.control_commands + ControlReconciler background scan',
    guarantee: 'Self-healing desired-state and command delivery convergence (Rule 18 & ADR-006)',
  },
  {
    path: 8,
    name: 'Snapshot object lost or corrupted in storage (MinIO)',
    mechanism: 'SHA-256 content_hash verification + fallback to raw MySQL event replay',
    guarantee:
      'Transparent fallback to genesis replay; non-circular hash parity preserved (Rule 14 & ADR-009)',
  },
] as const;

export function registerRecoverCommand(program: Command): void {
  const recover = program
    .command('recover')
    .description('Disaster Recovery Verification & Procedures (Phase 12, Rule 23)');

  recover
    .command('list')
    .description('List all 8 formal disaster recovery paths and guarantees')
    .action(() => {
      console.log(chalk.bold.cyan('\n🛡️  CHRONOSCOPE Eight Formal Recovery Paths (Rule 23):\n'));
      for (const p of RECOVERY_PATHS) {
        console.log(`  ${chalk.yellow(`Path ${p.path}:`)} ${chalk.bold.white(p.name)}`);
        console.log(`    ${chalk.gray('Mechanism:')} ${p.mechanism}`);
        console.log(`    ${chalk.gray('Guarantee:')} ${chalk.green(p.guarantee)}\n`);
      }
    });

  recover
    .command('projection')
    .description('Execute Path 5: Cold Read-Store Recovery from MySQL to MongoDB')
    .option('-p, --projection <name>', 'Projection name', 'order_summary')
    .option('-t, --timeline <id>', 'Timeline ID', '00000000-0000-0000-0000-000000000001')
    .action(async (options) => {
      await rebuildProjectionCommand({
        projection: options.projection,
        timeline: options.timeline,
      });
    });
}
