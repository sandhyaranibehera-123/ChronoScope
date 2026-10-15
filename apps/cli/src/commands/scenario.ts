import chalk from 'chalk';
import { getMysqlPool, MysqlScenarioInputManager } from '@chronoscope/database';

export interface ScenarioAddCommandOptions {
  readonly timeline: string;
  readonly type: string;
  readonly aggregate?: string | undefined;
  readonly params?: string | undefined;
}

export interface ScenarioListCommandOptions {
  readonly timeline: string;
}

export async function scenarioAddCommand(options: ScenarioAddCommandOptions): Promise<void> {
  let parsedParams: Record<string, unknown> | null = null;
  if (options.params) {
    try {
      parsedParams = JSON.parse(options.params);
    } catch {
      console.error(chalk.red('Invalid JSON format for --params'));
      process.exit(1);
    }
  }

  console.log(chalk.bold.cyan(`\n🧪 CHRONOSCOPE Scenario Input Engine (Phase 7)`));
  console.log(chalk.gray(`Timeline ID       : `) + chalk.white(options.timeline));
  console.log(chalk.gray(`Input Type        : `) + chalk.yellow(options.type));
  if (options.aggregate) {
    console.log(chalk.gray(`Target Aggregate  : `) + chalk.white(options.aggregate));
  }

  try {
    const pool = getMysqlPool();
    const scenarioManager = new MysqlScenarioInputManager(pool);

    const record = await scenarioManager.recordInput({
      timelineId: options.timeline,
      aggregateId: options.aggregate ?? null,
      inputType: options.type,
      parameters: parsedParams,
    });

    console.log(chalk.bold.green(`\n✔ Scenario Input Registered Successfully`));
    console.log(chalk.gray(`Input ID          : `) + chalk.green(record.inputId));
    console.log(chalk.gray(`Applied           : `) + chalk.white(record.applied));
    console.log(chalk.gray(`Created At        : `) + chalk.white(record.createdAt));
  } catch (err) {
    const error = err as Error;
    console.error(chalk.bold.red(`\n✖ Scenario Input Failed:`), error.message);
    process.exit(1);
  }
}

export async function scenarioListCommand(options: ScenarioListCommandOptions): Promise<void> {
  console.log(
    chalk.bold.cyan(`\n🧪 CHRONOSCOPE Scenario Inputs for Timeline: `) +
      chalk.white(options.timeline),
  );

  try {
    const pool = getMysqlPool();
    const scenarioManager = new MysqlScenarioInputManager(pool);
    const inputs = await scenarioManager.getInputsByTimeline(options.timeline);

    if (inputs.length === 0) {
      console.log(chalk.gray(`No scenario inputs found for this timeline.`));
      return;
    }

    console.log();
    for (const input of inputs) {
      console.log(
        chalk.yellow(`• [${input.inputType}] `) +
          chalk.gray(
            `id: ${input.inputId} | applied: ${input.applied ? chalk.green('true') : chalk.gray('false')}`,
          ) +
          (input.aggregateId ? chalk.gray(` | agg: ${input.aggregateId}`) : ''),
      );
      if (input.parameters) {
        console.log(chalk.gray(`  Params: ${JSON.stringify(input.parameters)}`));
      }
    }
  } catch (err) {
    const error = err as Error;
    console.error(chalk.bold.red(`\n✖ Failed to list scenario inputs:`), error.message);
    process.exit(1);
  }
}
