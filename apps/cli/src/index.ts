#!/usr/bin/env node
import { Command } from 'commander';
import { doctorCommand } from './commands/doctor.js';
import { tokenCommand } from './commands/token.js';
import { rebuildProjectionCommand } from './commands/rebuild-projection.js';
import { replayCommand } from './commands/replay.js';
import { snapshotCommand } from './commands/snapshot.js';
import { forkCommand } from './commands/fork.js';
import { scenarioAddCommand, scenarioListCommand } from './commands/scenario.js';
import { diffCommand } from './commands/diff.js';
import { causalCommand } from './commands/causal.js';
import { registerJobCommand } from './commands/job.js';
import { registerControlCommand } from './commands/control.js';
import { registerChaosCommand } from './commands/chaos.js';
import { registerExperimentCommand } from './commands/experiment.js';
import { registerRecoverCommand } from './commands/recover.js';
import { registerBenchCommand } from './commands/bench.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerDemoCommand } from './commands/demo.js';

const program = new Command();

program.name('chronoscope').description('CHRONOSCOPE CLI').version('0.1.0');

program
  .command('doctor')
  .description('Check infrastructure health (mode-aware)')
  .action(async () => {
    await doctorCommand();
  });

program
  .command('token')
  .description('Mint a local dev JWT (requires DEV_AUTH_MODE=true)')
  .requiredOption('--role <role>', 'viewer | operator | researcher | admin')
  .action((options: { role: string }) => {
    tokenCommand(options);
  });

program
  .command('rebuild-projection')
  .description(
    'Deterministically rebuild a MongoDB projection from authoritative MySQL history (Phase 5)',
  )
  .option('--projection <name>', 'Projection name to rebuild (default: order_summary)')
  .option('--timeline <id>', 'Timeline ID to rebuild (default: MAIN timeline)')
  .option('--partitions <count>', 'Number of Kafka partition fences to acquire (default: 4)')
  .option('--timeout <seconds>', 'Advisory lock timeout in seconds (default: 10)')
  .action(
    async (options: {
      projection?: string;
      timeline?: string;
      partitions?: string;
      timeout?: string;
    }) => {
      await rebuildProjectionCommand(options);
    },
  );

program
  .command('replay')
  .description('Deterministically replay an aggregate and verify live/replay hash parity (Phase 6)')
  .requiredOption('--aggregate <id>', 'Aggregate ID to replay')
  .option('--timeline <id>', 'Timeline ID (default: MAIN timeline)')
  .option('--type <type>', 'Aggregate type (Order, Payment, Inventory, Shipment; default: Order)')
  .option('--sequence <n>', 'Target aggregate sequence (default: latest sequence)')
  .option('--no-snapshot', 'Bypass snapshot fast-forward and replay from genesis')
  .option('--seed <seed>', 'Scenario seed for ExecutionContext (default: cli-replay-seed)')
  .action(
    async (options: {
      aggregate: string;
      timeline?: string;
      type?: string;
      sequence?: string;
      noSnapshot?: boolean;
      seed?: string;
    }) => {
      await replayCommand(options);
    },
  );

const snapshotCmd = program.command('snapshot').description('Manage state snapshots (Phase 6)');

snapshotCmd
  .command('create')
  .description('Capture point-in-time aggregate snapshot and verify content hash (Rule 14)')
  .requiredOption('--aggregate <id>', 'Aggregate ID to snapshot')
  .requiredOption('--sequence <n>', 'Target aggregate sequence')
  .option('--timeline <id>', 'Timeline ID (default: MAIN timeline)')
  .option('--type <type>', 'Aggregate type (default: Order)')
  .action(
    async (options: { aggregate: string; sequence: string; timeline?: string; type?: string }) => {
      await snapshotCommand(options);
    },
  );

program
  .command('fork')
  .description('Fork an execution timeline without copying history (Rules 6 & 13, ADR-010)')
  .requiredOption('--parent <parent-id>', 'Parent timeline ID to fork from')
  .requiredOption('--name <name>', 'Branch timeline name')
  .option('--position <pos>', 'Parent timeline position to fork at (default: 0)')
  .option('--description <desc>', 'Branch description')
  .action(
    async (options: { parent: string; name: string; position?: string; description?: string }) => {
      await forkCommand(options);
    },
  );

const scenarioCmd = program
  .command('scenario')
  .description('Manage counterfactual scenario inputs (Phase 7)');

scenarioCmd
  .command('add')
  .description('Persist a scenario input directive (Rule 12 & 27)')
  .requiredOption('--timeline <id>', 'Target timeline ID')
  .requiredOption('--type <type>', 'Scenario input type (e.g. ForcePaymentFailure)')
  .option('--aggregate <id>', 'Target aggregate ID')
  .option('--params <json>', 'JSON parameters string')
  .action(
    async (options: { timeline: string; type: string; aggregate?: string; params?: string }) => {
      await scenarioAddCommand(options);
    },
  );

scenarioCmd
  .command('list')
  .description('List registered scenario inputs for a timeline')
  .requiredOption('--timeline <id>', 'Target timeline ID')
  .action(async (options: { timeline: string }) => {
    await scenarioListCommand(options);
  });

program
  .command('diff')
  .description('Diff states, hashes, and event streams between two timelines (Phase 7)')
  .requiredOption('--base <base-id>', 'Base timeline ID (e.g. MAIN)')
  .requiredOption('--branch <branch-id>', 'Branch timeline ID')
  .option('--aggregate <id>', 'Optional aggregate ID to compare state')
  .action(async (options: { base: string; branch: string; aggregate?: string }) => {
    await diffCommand(options);
  });

program
  .command('causal')
  .description('Explore causal graphs, trace blast-radius, and explain root causes (Phase 8)')
  .option('--event <id>', 'Trace causality around a specific event ID')
  .option('--direction <dir>', 'Trace direction: upstream | downstream | both (default: both)')
  .option('--workflow <id>', 'Build causal DAG for an entire workflow (correlation_id)')
  .option('--timeline <id>', 'Build causal graph for a timeline (timeline_id)')
  .option('--explain <id>', 'Explain root cause for a specific failure or terminal event ID')
  .option('--format <fmt>', 'Output format: text | dot | mermaid | json (default: text)')
  .action(
    async (options: {
      event?: string;
      direction?: 'upstream' | 'downstream' | 'both';
      workflow?: string;
      timeline?: string;
      explain?: string;
      format?: 'text' | 'dot' | 'mermaid' | 'json';
    }) => {
      await causalCommand(options);
    },
  );

registerJobCommand(program);
registerControlCommand(program);
registerChaosCommand(program);
registerExperimentCommand(program);
registerRecoverCommand(program);
registerBenchCommand(program);
registerAuditCommand(program);
registerDemoCommand(program);

program.parse();
