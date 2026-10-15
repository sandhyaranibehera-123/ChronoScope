import chalk from 'chalk';
import { getMysqlPool } from '@chronoscope/database';
import { getMongoDatabase, MongoOrderSummaryRepository } from '@chronoscope/read-store';
import { MysqlRebuildMetadataManager } from '@chronoscope/database';
import {
  AuthoritativeStateResolver,
  MysqlEventReader,
  ProjectionRebuildController,
} from '@chronoscope/replay-engine';

export interface RebuildProjectionCommandOptions {
  projection?: string;
  timeline?: string;
  partitions?: string;
  timeout?: string;
}

export async function rebuildProjectionCommand(
  options: RebuildProjectionCommandOptions,
): Promise<void> {
  const projectionName = options.projection ?? 'order_summary';
  const timelineId = options.timeline ?? '00000000-0000-0000-0000-000000000001';
  const partitionCount = options.partitions ? parseInt(options.partitions, 10) : 4;
  const lockTimeoutSeconds = options.timeout ? parseInt(options.timeout, 10) : 10;

  console.log(chalk.bold.cyan(`\n⚡ CHRONOSCOPE Projection Rebuild Engine (Phase 5)`));
  console.log(chalk.gray(`Target Projection : `) + chalk.yellow(projectionName));
  console.log(chalk.gray(`Timeline ID       : `) + chalk.white(timelineId));
  console.log(chalk.gray(`Kafka Partitions  : `) + chalk.white(partitionCount));
  console.log(chalk.gray(`Lock Timeout (s)  : `) + chalk.white(lockTimeoutSeconds));
  console.log();

  try {
    const mysqlPool = getMysqlPool();
    const mongoDb = getMongoDatabase();

    const metadataManager = new MysqlRebuildMetadataManager(mysqlPool);
    const orderSummaryRepo = new MongoOrderSummaryRepository(mongoDb);
    const eventReader = new MysqlEventReader(mysqlPool);
    const stateResolver = new AuthoritativeStateResolver(eventReader);

    const controller = new ProjectionRebuildController(
      metadataManager,
      orderSummaryRepo,
      stateResolver,
    );

    console.log(
      chalk.blue(`[1/6] Acquiring rebuild controller lock & capturing cutoff watermarks...`),
    );
    console.log(
      chalk.blue(
        `[2/6] Quiescing live projection workers via ascending partition advisory fences...`,
      ),
    );
    console.log(
      chalk.blue(
        `[3/6] Truncating shadow collection & replaying events via AuthoritativeStateResolver...`,
      ),
    );

    const result = await controller.rebuildProjection({
      projectionName,
      timelineId,
      partitionCount,
      lockTimeoutSeconds,
    });

    console.log(chalk.blue(`[4/6] Validating collection-level hashes against shadow state...`));
    console.log(
      chalk.blue(
        `[5/6] Swapping shadow collection to live target via renameCollection({ dropTarget: true })...`,
      ),
    );
    console.log(chalk.blue(`[6/6] Mirroring hashes into projection_metadata & releasing locks...`));

    console.log(chalk.bold.green(`\n✔ Projection rebuild succeeded in ${result.durationMs}ms!`));
    console.log(chalk.gray(`Run ID                     : `) + chalk.white(result.runId));
    console.log(chalk.gray(`Documents Written          : `) + chalk.white(result.documentsWritten));
    console.log(
      chalk.gray(`source_manifest_hash       : `) + chalk.green(result.sourceManifestHash),
    );
    console.log(
      chalk.gray(`projection_collection_hash : `) + chalk.green(result.projectionCollectionHash),
    );
    console.log();
  } catch (error) {
    const err = error as Error;
    console.error(chalk.bold.red(`\n✖ Projection rebuild failed: `) + chalk.red(err.message));
    console.error();
    process.exit(1);
  }
}
