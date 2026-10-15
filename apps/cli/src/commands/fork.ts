import chalk from 'chalk';
import { getMysqlPool, MySqlTimelineRepository } from '@chronoscope/database';
import { TimelineForkService } from '@chronoscope/replay-engine';

export interface ForkCommandOptions {
  readonly parent: string;
  readonly name: string;
  readonly position?: string | undefined;
  readonly description?: string | undefined;
}

export async function forkCommand(options: ForkCommandOptions): Promise<void> {
  const parentTimelineId = options.parent;
  const name = options.name;
  const forkPosition = options.position ? parseInt(options.position, 10) : 0;
  const description = options.description ?? null;

  console.log(chalk.bold.cyan(`\n🌿 CHRONOSCOPE Timeline Fork Engine (Phase 7)`));
  console.log(chalk.gray(`Parent Timeline   : `) + chalk.white(parentTimelineId));
  console.log(chalk.gray(`Branch Name       : `) + chalk.yellow(name));
  console.log(chalk.gray(`Fork Position     : `) + chalk.white(forkPosition));

  try {
    const mysqlPool = getMysqlPool();
    const timelineRepo = new MySqlTimelineRepository(mysqlPool);
    const forkService = new TimelineForkService(timelineRepo);

    const created = await forkService.fork({
      parentTimelineId,
      forkPosition,
      name,
      description,
    });

    console.log(chalk.bold.green(`\n✔ Branch Timeline Created Successfully`));
    console.log(chalk.gray(`Timeline ID       : `) + chalk.green(created.timelineId));
    console.log(chalk.gray(`Fork Position     : `) + chalk.white(created.forkPosition));
    console.log(chalk.gray(`Status            : `) + chalk.white(created.status));
    console.log(chalk.gray(`Created At        : `) + chalk.white(created.createdAt));
  } catch (err) {
    const error = err as Error;
    console.error(chalk.bold.red(`\n✖ Timeline Fork Failed:`), error.message);
    process.exit(1);
  }
}
