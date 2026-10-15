import chalk from 'chalk';
import type { RowDataPacket } from 'mysql2/promise';
import {
  getMysqlPool,
  MysqlExecutionManager,
  MysqlSnapshotMetadataManager,
  SQL,
} from '@chronoscope/database';
import {
  AuthoritativeStateResolver,
  MysqlEventReader,
  LiveReplayService,
  SnapshotManager,
  InMemorySnapshotStorage,
  type ILiveStateProvider,
} from '@chronoscope/replay-engine';

export interface ReplayCommandOptions {
  readonly timeline?: string | undefined;
  readonly aggregate: string;
  readonly type?: string | undefined;
  readonly sequence?: string | undefined;
  readonly noSnapshot?: boolean | undefined;
  readonly seed?: string | undefined;
}

interface AggregateStateRow extends RowDataPacket {
  aggregate_sequence: number | string;
  state: unknown;
  state_hash: string;
}

export async function replayCommand(options: ReplayCommandOptions): Promise<void> {
  const timelineId = options.timeline ?? '00000000-0000-0000-0000-000000000001';
  const aggregateId = options.aggregate;
  const aggregateType = options.type ?? 'Order';
  const targetSequence = options.sequence ? parseInt(options.sequence, 10) : undefined;
  const useSnapshot = options.noSnapshot ? false : true;
  const scenarioSeed = options.seed ?? 'cli-replay-seed';

  console.log(chalk.bold.cyan(`\n⚡ CHRONOSCOPE Deterministic Replay Engine (Phase 6)`));
  console.log(chalk.gray(`Timeline ID       : `) + chalk.white(timelineId));
  console.log(chalk.gray(`Aggregate ID      : `) + chalk.yellow(aggregateId));
  console.log(chalk.gray(`Aggregate Type    : `) + chalk.white(aggregateType));
  console.log(
    chalk.gray(`Target Sequence   : `) +
      chalk.white(targetSequence !== undefined ? targetSequence : 'Latest Head'),
  );
  console.log(chalk.gray(`Snapshot Enabled  : `) + chalk.white(useSnapshot));
  console.log();

  try {
    const mysqlPool = getMysqlPool();

    const eventReader = new MysqlEventReader(mysqlPool);
    const executionManager = new MysqlExecutionManager(mysqlPool);
    const metadataManager = new MysqlSnapshotMetadataManager(mysqlPool);
    const storage = new InMemorySnapshotStorage();
    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const snapshotManager = new SnapshotManager(metadataManager, storage, stateResolver);

    const liveStateProvider: ILiveStateProvider = {
      async getLiveState(tId: string, aId: string) {
        const [rows] = await mysqlPool.query<AggregateStateRow[]>(SQL.SELECT_AGGREGATE_STATE, [
          tId,
          aId,
        ]);
        const r = rows[0];
        if (!r) return null;
        return {
          sequence: Number(r.aggregate_sequence),
          state: r.state,
          stateHash: r.state_hash,
        };
      },
    };

    const replayService = new LiveReplayService(
      eventReader,
      executionManager,
      snapshotManager,
      liveStateProvider,
    );

    console.log(chalk.blue(`Executing LIVE_REPLAY directly against MySQL event history...`));

    const result = await replayService.replayAggregate({
      timelineId,
      aggregateId,
      aggregateType,
      targetSequence,
      useSnapshot,
      scenarioSeed,
    });

    console.log();
    console.log(chalk.bold.green(`✔ LIVE_REPLAY completed in ${result.durationMs}ms`));
    console.log(chalk.gray(`Execution ID      : `) + chalk.white(result.executionId));
    console.log(
      chalk.gray(`Sequence Range    : `) +
        chalk.white(`[${result.fromSequence} -> ${result.toSequence}]`),
    );
    console.log(
      chalk.gray(`Snapshot Fast-Fwd : `) +
        (result.snapshotId ? chalk.green(result.snapshotId) : chalk.gray('None (genesis replay)')),
    );
    console.log(chalk.gray(`Events Replayed   : `) + chalk.white(result.eventsReplayed));
    console.log(chalk.gray(`Replay State Hash : `) + chalk.cyan(result.stateHash));
    console.log(chalk.gray(`Live State Hash   : `) + chalk.cyan(result.liveStateHash));

    if (result.hashParityMatched) {
      console.log(
        chalk.gray(`Hash Parity       : `) +
          chalk.bold.green(`✔ MATCH (Live/Replay parity proven - Rule 9)`),
      );
    } else {
      console.log(
        chalk.gray(`Hash Parity       : `) + chalk.bold.red(`✖ MISMATCH (Divergence detected!)`),
      );
    }
    console.log();
  } catch (error) {
    const err = error as Error;
    console.error(chalk.bold.red(`\n✖ LIVE_REPLAY failed: `) + chalk.red(err.message));
    console.error();
    process.exit(1);
  }
}
