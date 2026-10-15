import chalk from 'chalk';
import { getMysqlPool, MysqlSnapshotMetadataManager } from '@chronoscope/database';
import {
  AuthoritativeStateResolver,
  MysqlEventReader,
  SnapshotManager,
  InMemorySnapshotStorage,
} from '@chronoscope/replay-engine';

export interface SnapshotCommandOptions {
  readonly timeline?: string | undefined;
  readonly aggregate: string;
  readonly sequence: string;
  readonly type?: string | undefined;
}

export async function snapshotCommand(options: SnapshotCommandOptions): Promise<void> {
  const timelineId = options.timeline ?? '00000000-0000-0000-0000-000000000001';
  const aggregateId = options.aggregate;
  const targetSequence = parseInt(options.sequence, 10);
  const aggregateType = options.type ?? 'Order';

  if (isNaN(targetSequence) || targetSequence <= 0) {
    console.error(chalk.red('Error: --sequence must be a positive integer'));
    process.exit(1);
  }

  console.log(chalk.bold.cyan(`\n⚡ CHRONOSCOPE Snapshot Capture Engine (Rule 14 & ADR-009)`));
  console.log(chalk.gray(`Timeline ID       : `) + chalk.white(timelineId));
  console.log(chalk.gray(`Aggregate ID      : `) + chalk.yellow(aggregateId));
  console.log(chalk.gray(`Aggregate Type    : `) + chalk.white(aggregateType));
  console.log(chalk.gray(`Target Sequence   : `) + chalk.white(targetSequence));
  console.log();

  try {
    const mysqlPool = getMysqlPool();
    const eventReader = new MysqlEventReader(mysqlPool);
    const metadataManager = new MysqlSnapshotMetadataManager(mysqlPool);
    const storage = new InMemorySnapshotStorage();
    const stateResolver = new AuthoritativeStateResolver(eventReader);
    const snapshotManager = new SnapshotManager(metadataManager, storage, stateResolver);

    console.log(chalk.blue(`Capturing point-in-time state cut and verifying content_hash...`));

    const snapshot = await snapshotManager.createAggregateSnapshot({
      timelineId,
      aggregateId,
      targetSequence,
      aggregateType,
    });

    console.log();
    console.log(chalk.bold.green(`✔ Snapshot captured and verified READY`));
    console.log(chalk.gray(`Snapshot ID       : `) + chalk.white(snapshot.snapshotId));
    console.log(chalk.gray(`Aggregate Sequence: `) + chalk.white(snapshot.aggregateSequence));
    console.log(chalk.gray(`State Hash        : `) + chalk.cyan(snapshot.stateHash));
    console.log(chalk.gray(`Content Hash      : `) + chalk.green(snapshot.contentHash));
    console.log(chalk.gray(`Storage Location  : `) + chalk.white(snapshot.storageLocation));
    console.log(chalk.gray(`Status            : `) + chalk.green(snapshot.status));
    console.log();
  } catch (error) {
    const err = error as Error;
    console.error(chalk.bold.red(`\n✖ Snapshot capture failed: `) + chalk.red(err.message));
    console.error();
    process.exit(1);
  }
}
