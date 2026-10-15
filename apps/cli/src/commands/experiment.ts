import type { Command } from 'commander';
import chalk from 'chalk';
import { ExperimentRunner, ChaosEngine } from '@chronoscope/chaos';
import { getMysqlPool, MysqlExperimentManager, MysqlAuditLogger } from '@chronoscope/database';

function getManagers(): { runner: ExperimentRunner; manager: MysqlExperimentManager } {
  const pool = getMysqlPool();
  const manager = new MysqlExperimentManager(pool);
  const auditLogger = new MysqlAuditLogger(pool);
  const chaosEngine = new ChaosEngine({
    chaosEnabled: process.env['CHAOS_MODE'] === 'true',
    auditLogger,
  });
  const runner = new ExperimentRunner(manager, chaosEngine);
  return { runner, manager };
}

export function registerExperimentCommand(program: Command): void {
  const expCmd = program
    .command('experiment')
    .description('Reproducible Experiments & Verification (Phase 11, Rule 22)');

  expCmd
    .command('list')
    .description('List registered experiments')
    .action(async () => {
      try {
        const { manager } = getManagers();
        const experiments = await manager.listExperiments();

        if (experiments.length === 0) {
          console.log(
            chalk.gray('No registered experiments found in chronoscope_ops.experiments.'),
          );
          return;
        }

        console.log(chalk.bold(`Registered Experiments (${experiments.length}):`));
        for (const exp of experiments) {
          console.log(
            `- [${chalk.cyan(exp.experimentId)}] ${chalk.bold(exp.name)} (${exp.category})`,
          );
          console.log(`    ${chalk.gray(exp.description)}`);
        }
      } catch (error) {
        console.error(
          chalk.red(
            `Failed to list experiments: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    });

  expCmd
    .command('run')
    .description('Execute a reproducible experiment run (Rule 22)')
    .requiredOption('--id <experiment-id>', 'Experiment ID to run')
    .option('--seed <seed>', 'Scenario seed')
    .action(async (options: { id: string; seed?: string }) => {
      try {
        const { runner } = getManagers();
        console.log(chalk.blue(`Initiating experiment run for '${options.id}'...`));

        const runRecord = await runner.runExperiment({
          experimentId: options.id,
          scenarioSeed: options.seed,
          actorRole: 'admin',
          actorId: 'cli-operator',
        });

        console.log(chalk.green(`✓ Experiment run completed`));
        console.log(`  Run ID:            ${chalk.cyan(runRecord.runId)}`);
        console.log(
          `  Status:            ${runRecord.status === 'COMPLETED' ? chalk.green('COMPLETED') : chalk.red(runRecord.status)}`,
        );
        console.log(
          `  Invariants Passed: ${runRecord.invariantsPassed ? chalk.green('YES') : chalk.red('NO')}`,
        );
        console.log(`  Git SHA:           ${runRecord.manifest.gitSha}`);
        console.log(
          `  MySQL Version:     ${runRecord.manifest.machineProfile.mysqlVersion} (${runRecord.manifest.machineProfile.mysqlImageDigest.slice(0, 19)}...)`,
        );
        console.log(
          `  MongoDB Version:   ${runRecord.manifest.machineProfile.mongodbVersion} (${runRecord.manifest.machineProfile.mongodbImageDigest.slice(0, 19)}...)`,
        );
        console.log(`  Node Version:      ${runRecord.manifest.machineProfile.nodeVersion}`);
        console.log(`  Config Hash:       ${runRecord.manifest.configHash.slice(0, 16)}...`);

        if (runRecord.errorMessage) {
          console.log(`  Error:             ${chalk.red(runRecord.errorMessage)}`);
        }
      } catch (error) {
        console.error(
          chalk.red(
            `Experiment run failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    });

  expCmd
    .command('status')
    .description('View run status and invariant outcomes')
    .requiredOption('--run <run-id>', 'Run ID to query')
    .action(async (options: { run: string }) => {
      try {
        const { manager } = getManagers();
        const run = await manager.getRun(options.run);
        if (!run) {
          console.error(chalk.red(`Experiment run '${options.run}' not found.`));
          process.exitCode = 1;
          return;
        }

        console.log(chalk.bold(`Experiment Run Details: ${options.run}`));
        console.log(`  Experiment ID:     ${run.experimentId}`);
        console.log(`  Status:            ${run.status}`);
        console.log(
          `  Invariants Passed: ${run.invariantsPassed ? chalk.green('YES') : chalk.red('NO')}`,
        );
        console.log(`  Started At:        ${run.startedAt.toISOString()}`);
        console.log(`  Completed At:      ${run.completedAt?.toISOString() ?? 'In progress'}`);

        const invariants = await manager.getRunInvariants(options.run);
        if (invariants.length > 0) {
          console.log(chalk.bold(`\nEvaluated Invariants (${invariants.length}):`));
          for (const inv of invariants) {
            const icon = inv.status === 'PASSED' ? chalk.green('✓') : chalk.red('✗');
            console.log(
              `  ${icon} [${inv.status}] ${chalk.bold(inv.invariantName)}: ${inv.details ?? ''}`,
            );
          }
        }
      } catch (error) {
        console.error(
          chalk.red(
            `Failed to query run status: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    });

  expCmd
    .command('history')
    .description('List recent experiment runs from chronoscope_ops.experiment_runs')
    .option('--limit <count>', 'Maximum runs to list (default: 10)', '10')
    .action(async (options: { limit: string }) => {
      try {
        const { manager } = getManagers();
        const limit = Number.parseInt(options.limit, 10);
        const runs = await manager.listRecentRuns(limit);

        if (runs.length === 0) {
          console.log(chalk.gray('No experiment runs recorded.'));
          return;
        }

        console.log(chalk.bold(`Recent Experiment Runs (${runs.length}):`));
        for (const run of runs) {
          const statusChalk = run.status === 'COMPLETED' ? chalk.green : chalk.yellow;
          console.log(
            `- ${chalk.cyan(run.runId)} [${statusChalk(run.status)}] Exp: ${run.experimentId} at ${run.startedAt.toISOString()}`,
          );
        }
      } catch (error) {
        console.error(
          chalk.red(
            `Failed to list run history: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    });
}
