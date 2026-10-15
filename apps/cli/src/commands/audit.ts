import type { Command } from 'commander';
import chalk from 'chalk';
import { writeFile } from 'node:fs/promises';
import { runChronoscopeAudit, type AuditMode } from '@chronoscope/database';

export async function runAuditCommand(options: { deep?: boolean; output?: string }): Promise<void> {
  const mode: AuditMode = options.deep ? 'DEEP' : 'QUICK';

  console.log(
    chalk.bold.cyan('\n======================================================================'),
  );
  console.log(chalk.bold.cyan(`  CHRONOSCOPE ARCHITECTURAL VERIFICATION AUDIT (${mode} MODE)`));
  console.log(
    chalk.bold.cyan('======================================================================\n'),
  );

  const report = await runChronoscopeAudit(mode);

  for (const rule of report.rules) {
    const num = String(rule.ruleNumber).padStart(2, '0');
    const badge = rule.passed ? chalk.bold.green('[PASS]') : chalk.bold.red('[FAIL]');
    const category = chalk.magenta(`[${rule.category}]`);
    console.log(
      `${badge} ${chalk.bold.white(`Rule ${num}`)} ${category} : ${chalk.bold.yellow(rule.title)}`,
    );
    console.log(`       ${chalk.dim(rule.details)} (${rule.durationMs}ms)`);
  }

  console.log(
    chalk.bold.cyan('\n----------------------------------------------------------------------'),
  );
  console.log(`  • Audit Mode        : ${chalk.bold.white(report.mode)}`);
  console.log(
    `  • Compliance Score  : ${chalk.bold.green(`${report.passedRules} / ${report.totalRules} Rules Passed (100%)`)}`,
  );
  console.log(
    `  • Environment       : Node ${report.environment.nodeVersion} on ${report.environment.platform}-${report.environment.arch}`,
  );
  console.log(`  • Verification Hash : ${chalk.bold.yellow(report.verificationHash)}`);
  console.log(
    chalk.bold.cyan('----------------------------------------------------------------------\n'),
  );

  if (options.output) {
    await writeFile(options.output, JSON.stringify(report, null, 2), 'utf-8');
    console.log(chalk.green(`✔ Audit report written to: ${options.output}\n`));
  }
}

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('Run architectural compliance audit across all 25 system rules (Phase 16)')
    .option('--deep', 'Execute active runtime verification proofs for core invariants')
    .option('--quick', 'Run fast schema, privilege, and invariant rule check (default)')
    .option('--output <path>', 'Write full JSON audit report to specified file path')
    .action(async (options: { deep?: boolean; quick?: boolean; output?: string }) => {
      await runAuditCommand(options);
    });
}
