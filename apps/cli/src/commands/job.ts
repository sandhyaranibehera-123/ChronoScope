import type { Command } from 'commander';
import { getMysqlPool, MysqlJobManager } from '@chronoscope/database';

export function registerJobCommand(program: Command): void {
  const jobCmd = program
    .command('job')
    .description('Manage asynchronous background jobs (Rules 8 & 10, ADR-005)');

  jobCmd
    .command('submit')
    .description('Submit an asynchronous background job with an idempotency key')
    .requiredOption(
      '--type <type>',
      'Job type (e.g. SNAPSHOT_GENERATION, PROJECTION_REBUILD, EXPORT, BENCHMARK)',
    )
    .requiredOption('--idempotency-key <key>', 'Unique idempotency key for at-most-once execution')
    .option('--payload <json>', 'JSON string payload', '{}')
    .option('--queue <queue>', 'Target RabbitMQ queue name')
    .option('--max-attempts <n>', 'Maximum retry attempts', '5')
    .action(async (options) => {
      const pool = getMysqlPool();
      try {
        const jobManager = new MysqlJobManager(pool);
        let parsedPayload: Record<string, unknown> = {};
        try {
          parsedPayload = JSON.parse(options.payload);
        } catch {
          console.error('Invalid JSON payload provided.');
          process.exitCode = 1;
          return;
        }

        const result = await jobManager.createJob({
          jobType: options.type,
          idempotencyKey: options.idempotencyKey,
          payload: parsedPayload,
          queueName: options.queue,
          maxAttempts: Number(options.maxAttempts),
        });

        console.log(`Job Submission Result:`);
        console.log(`─`.repeat(40));
        console.log(`Job ID:          ${result.job.jobId}`);
        console.log(`Job Type:        ${result.job.jobType}`);
        console.log(`Idempotency Key: ${result.job.idempotencyKey}`);
        console.log(`Status:          ${result.job.status}`);
        console.log(
          `Is New:          ${result.isNew ? 'YES (Created)' : 'NO (Idempotent Deduplication)'}`,
        );
        console.log(`Scheduled At:    ${result.job.scheduledAt}`);
      } catch (err) {
        console.error('Failed to submit job:', err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  jobCmd
    .command('status')
    .description('Check the status and result reference of a background job')
    .requiredOption('--id <id>', 'Job ID')
    .action(async (options) => {
      const pool = getMysqlPool();
      try {
        const jobManager = new MysqlJobManager(pool);
        const job = await jobManager.getJobById(options.id);
        if (!job) {
          console.error(`Job ${options.id} not found.`);
          process.exitCode = 1;
          return;
        }

        console.log(`Job Status: ${job.jobId}`);
        console.log(`─`.repeat(40));
        console.log(`Job Type:         ${job.jobType}`);
        console.log(`Idempotency Key:  ${job.idempotencyKey}`);
        console.log(`Status:           ${job.status}`);
        console.log(`Attempts:         ${job.attemptCount} / ${job.maxAttempts}`);
        console.log(`Result Reference: ${job.resultReference ?? '(none)'}`);
        console.log(`Error Message:    ${job.errorMessage ?? '(none)'}`);
        console.log(`Scheduled At:     ${job.scheduledAt}`);
        console.log(`Started At:       ${job.startedAt ?? '(not started)'}`);
        console.log(`Completed At:     ${job.completedAt ?? '(not completed)'}`);
      } catch (err) {
        console.error(
          'Failed to get job status:',
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });

  jobCmd
    .command('list')
    .description('List recent background jobs from chronoscope_ops.jobs')
    .option('--limit <n>', 'Maximum jobs to return', '20')
    .action(async (options) => {
      const pool = getMysqlPool();
      try {
        const jobManager = new MysqlJobManager(pool);
        const jobs = await jobManager.listJobs(Number(options.limit));

        console.log(`Recent Background Jobs (${jobs.length} items):`);
        console.log(`─`.repeat(60));
        for (const j of jobs) {
          const statusPad = j.status.padEnd(12);
          const typePad = j.jobType.padEnd(20);
          console.log(`[${statusPad}] ${typePad} | ID: ${j.jobId} | Key: ${j.idempotencyKey}`);
        }
      } catch (err) {
        console.error('Failed to list jobs:', err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
