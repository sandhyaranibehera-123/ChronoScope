import chalk from 'chalk';
import type { RowDataPacket } from 'mysql2/promise';
import {
  getMysqlPool,
  MySqlTimelineRepository,
  MysqlScenarioInputManager,
  SQL,
} from '@chronoscope/database';
import {
  TimelineDiffEngine,
  MysqlEventReader,
  type StateProvider,
} from '@chronoscope/replay-engine';

export interface DiffCommandOptions {
  readonly base: string;
  readonly branch: string;
  readonly aggregate?: string | undefined;
}

interface AggregateStateRow extends RowDataPacket {
  aggregate_sequence: number | string;
  state: string | Record<string, unknown>;
  state_hash: string;
}

export async function diffCommand(options: DiffCommandOptions): Promise<void> {
  const timelineIdA = options.base;
  const timelineIdB = options.branch;
  const aggregateId = options.aggregate;

  console.log(chalk.bold.cyan(`\n🔍 CHRONOSCOPE Timeline Diff Engine (Phase 7)`));
  console.log(chalk.gray(`Base Timeline (A) : `) + chalk.white(timelineIdA));
  console.log(chalk.gray(`Branch Timeline(B): `) + chalk.yellow(timelineIdB));
  if (aggregateId) {
    console.log(chalk.gray(`Target Aggregate  : `) + chalk.white(aggregateId));
  }
  console.log();

  try {
    const pool = getMysqlPool();
    const timelineRepo = new MySqlTimelineRepository(pool);
    const scenarioManager = new MysqlScenarioInputManager(pool);
    const eventReader = new MysqlEventReader(pool);

    const provider: StateProvider = {
      async getState(tId: string, aggId: string) {
        const [rows] = await pool.query<AggregateStateRow[]>(SQL.SELECT_AGGREGATE_STATE, [
          tId,
          aggId,
        ]);
        const row = rows[0];
        if (!row) return null;
        const state = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
        return { state, stateHash: row.state_hash };
      },
      async getAncestry(tId: string) {
        return timelineRepo.getAncestry(tId);
      },
      async getEffectiveEvents(tId: string, aggId?: string) {
        return aggId
          ? eventReader.loadEventsForAggregate(tId, aggId)
          : timelineRepo.getEffectiveEvents(tId);
      },
      async getScenarioInputs(tId: string) {
        return scenarioManager.getInputsByTimeline(tId);
      },
    };

    const diffEngine = new TimelineDiffEngine(provider);
    const result = await diffEngine.diff({
      timelineIdA,
      timelineIdB,
      aggregateId,
    });

    console.log(chalk.bold(`── Timeline Hierarchy ──`));
    console.log(
      chalk.gray(`Common Ancestor   : `) + chalk.white(result.commonAncestorTimelineId ?? 'None'),
    );
    console.log(chalk.gray(`Fork Position     : `) + chalk.white(result.forkPosition));

    if (aggregateId) {
      console.log(chalk.bold(`\n── Aggregate State Comparison [${aggregateId}] ──`));
      console.log(chalk.gray(`State Hash (A)    : `) + chalk.white(result.stateHashA ?? 'None'));
      console.log(chalk.gray(`State Hash (B)    : `) + chalk.white(result.stateHashB ?? 'None'));
      console.log(
        chalk.gray(`Hashes Match      : `) +
          (result.hashesMatch ? chalk.green('✔ MATCH') : chalk.red('✖ DIVERGED')),
      );

      if (result.stateDiff.status) {
        console.log(
          chalk.gray(`Status Change     : `) +
            chalk.cyan(String(result.stateDiff.status.from)) +
            chalk.gray(' ➔ ') +
            chalk.magenta(String(result.stateDiff.status.to)),
        );
      }

      if (result.stateDiff.fieldsChanged) {
        console.log(chalk.gray(`Fields Changed    :`));
        for (const [key, change] of Object.entries(result.stateDiff.fieldsChanged)) {
          console.log(
            `  ${chalk.yellow(key)}: ${JSON.stringify(change.from)} ➔ ${JSON.stringify(change.to)}`,
          );
        }
      }
    }

    console.log(chalk.bold(`\n── Diverging Events ──`));
    console.log(
      chalk.gray(`Events on A after fork: `) + chalk.white(result.divergingEventsA.length),
    );
    console.log(
      chalk.gray(`Events on B after fork: `) + chalk.yellow(result.divergingEventsB.length),
    );

    if (result.stateDiff.divergenceReason) {
      console.log(chalk.bold(`\n── Causal Divergence Explanation ──`));
      console.log(chalk.yellow(`ℹ ${result.stateDiff.divergenceReason}`));
    }
  } catch (err) {
    const error = err as Error;
    console.error(chalk.bold.red(`\n✖ Timeline Diff Failed:`), error.message);
    process.exit(1);
  }
}
