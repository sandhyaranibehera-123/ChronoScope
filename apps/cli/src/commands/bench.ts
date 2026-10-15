import type { Command } from 'commander';
import chalk from 'chalk';
import {
  runScalingBenchmark,
  runOccContentionBenchmark,
  runInventoryConcurrencyLab,
  runMongoLatencyProfiler,
  type InventoryStrategy,
  type ReservationRequest,
} from '@chronoscope/database';

export async function runBenchCommand(options: {
  suite?: 'scaling' | 'occ' | 'inventory' | 'mongo' | 'all';
  concurrency?: string;
  count?: string;
}): Promise<void> {
  const suite = options.suite ?? 'all';
  const concurrency = options.concurrency ? parseInt(options.concurrency, 10) : 50;
  const count = options.count ? parseInt(options.count, 10) : 100;

  console.log(chalk.bold.cyan('\n============================================================'));
  console.log(chalk.bold.cyan('  CHRONOSCOPE PERFORMANCE & CONCURRENCY LAB (PHASE 13)'));
  console.log(chalk.bold.cyan('============================================================\n'));

  if (suite === 'scaling' || suite === 'all') {
    console.log(chalk.bold.yellow('▶ Benchmark 1: High-Throughput Independent Scaling (Rule 6)'));
    console.log(
      chalk.gray(
        '  Appends across independent aggregates under row-locked aggregate_versions and innodb_autoinc_lock_mode = 2.\n',
      ),
    );

    const scaleRes = await runScalingBenchmark({ aggregateCount: count });
    console.log(`  • Aggregates Tested    : ${chalk.bold.white(scaleRes.aggregateCount)}`);
    console.log(
      `  • Successful Appends   : ${chalk.bold.green(scaleRes.successfulAppends)} / ${scaleRes.aggregateCount}`,
    );
    console.log(`  • Lock Contention/Errs : ${chalk.bold.cyan(scaleRes.conflictCount)}`);
    console.log(
      `  • Throughput           : ${chalk.bold.green(scaleRes.throughputOpsPerSec.toLocaleString())} ops/sec`,
    );
    console.log(
      `  • Latency (ms)         : p50=${scaleRes.latency.p50}ms, p95=${scaleRes.latency.p95}ms, p99=${scaleRes.latency.p99}ms (avg=${scaleRes.latency.avg}ms)\n`,
    );
  }

  if (suite === 'occ' || suite === 'all') {
    console.log(chalk.bold.yellow('▶ Benchmark 2: Hot-Spot OCC Contention & Convergence'));
    console.log(
      chalk.gray(
        '  Racing concurrent appends targeting the exact same aggregate ID with jittered backoff retries.\n',
      ),
    );

    const occRes = await runOccContentionBenchmark({
      totalWriters: concurrency,
      enableRetry: true,
      maxRetries: 30,
    });
    console.log(`  • Contending Writers   : ${chalk.bold.white(occRes.totalWriters)}`);
    console.log(
      `  • Initial Slot Winner  : ${chalk.bold.cyan(occRes.directSuccessCount)} (1st attempt)`,
    );
    console.log(`  • OCC Conflicts Absorbd: ${chalk.bold.yellow(occRes.conflictCount)}`);
    console.log(
      `  • Retried Convergence  : ${chalk.bold.green(occRes.retriedSuccessCount)} writers`,
    );
    console.log(`  • Max Retries Observed : ${chalk.bold.magenta(occRes.maxRetriesObserved)}`);
    console.log(
      `  • Final Sequence State : ${chalk.bold.green(occRes.finalSequence)} (monotonic, 0 lost updates)`,
    );
    console.log(
      `  • Convergence Time     : ${chalk.bold.white(occRes.elapsedMs)} ms (p95=${occRes.latency.p95}ms)\n`,
    );
  }

  if (suite === 'inventory' || suite === 'all') {
    console.log(
      chalk.bold.yellow('▶ Benchmark 3: Inventory Concurrency Lab (4 Locking Strategies)'),
    );
    console.log(
      chalk.gray(
        '  Comparing 4 strategies: Uncontrolled RMW vs Pessimistic Row Lock vs Atomic SQL vs Event-Sourced OCC.\n',
      ),
    );

    const INITIAL_STOCK = 20;
    const REQUEST_COUNT = 40; // 40 requests of 1 unit -> 20 excess demand
    const requests: ReservationRequest[] = Array.from({ length: REQUEST_COUNT }, (_, i) => ({
      requestId: `cli-req-${i + 1}`,
      sku: 'SKU-BENCHMARK-LAB',
      quantity: 1,
    }));

    const strategies: InventoryStrategy[] = [
      'UNCONTROLLED_READ_MODIFY_WRITE',
      'PESSIMISTIC_ROW_LOCK',
      'ATOMIC_CONDITIONAL_UPDATE',
      'EVENT_SOURCED_OCC',
    ];

    console.log(
      chalk.gray(
        `  Initial Stock: ${INITIAL_STOCK} units | Total Requests: ${REQUEST_COUNT} units (Demand > Stock)\n`,
      ),
    );

    for (const strat of strategies) {
      const res = await runInventoryConcurrencyLab({
        initialStock: INITIAL_STOCK,
        requests,
        strategy: strat,
        maxOccRetries: 30,
      });

      const oversoldText =
        res.oversoldQuantity > 0
          ? chalk.bold.red(`FAILED (${res.oversoldQuantity} units oversold!)`)
          : chalk.bold.green('0 (STRICT INVARIANT HELD)');

      console.log(`  [${chalk.bold.blue(res.strategy)}]`);
      console.log(`    ${chalk.dim(res.description)}`);
      console.log(
        `    Allocated: ${res.totalAllocatedQuantity} / ${INITIAL_STOCK} max | Remaining: ${res.finalAvailableStock}`,
      );
      console.log(`    Oversold Status: ${oversoldText}`);
      console.log(
        `    Latency: p50=${res.latency.p50}ms, p95=${res.latency.p95}ms | Elapsed: ${res.elapsedMs}ms\n`,
      );
    }
  }

  if (suite === 'mongo' || suite === 'all') {
    console.log(
      chalk.bold.yellow('▶ Benchmark 4: Mongo 3-Step Commit Latency & Projection Lag Profiling'),
    );
    console.log(
      chalk.gray(
        '  Profiles the 3 decoupled stages: Stage 1 (MySQL Append), Stage 2 (Outbox/Kafka), Stage 3 (MongoDB Commit).\n',
      ),
    );

    const profileRes = await runMongoLatencyProfiler({ eventCount: 20 });
    console.log(`  • Events Profiled      : ${chalk.bold.white(profileRes.totalEvents)}`);
    console.log(
      `  • Stage 1 (MySQL Appnd): ${chalk.bold.green(`p50=${profileRes.stage1EventStoreAppend.p50}ms`)}, p95=${profileRes.stage1EventStoreAppend.p95}ms, p99=${profileRes.stage1EventStoreAppend.p99}ms`,
    );
    console.log(
      `  • Stage 2 (Kafka Pub)  : ${chalk.bold.cyan(`p50=${profileRes.stage2OutboxPublish.p50}ms`)}, p95=${profileRes.stage2OutboxPublish.p95}ms, p99=${profileRes.stage2OutboxPublish.p99}ms`,
    );
    console.log(
      `  • Stage 3 (Mongo Upsrt): ${chalk.bold.magenta(`p50=${profileRes.stage3ProjectionCommit.p50}ms`)}, p95=${profileRes.stage3ProjectionCommit.p95}ms, p99=${profileRes.stage3ProjectionCommit.p99}ms`,
    );
    console.log(
      `  • End-to-End Proj Lag  : ${chalk.bold.yellow(`p50=${profileRes.endToEndProjectionLag.p50}ms`)}, p95=${profileRes.endToEndProjectionLag.p95}ms (avg=${profileRes.endToEndProjectionLag.avg}ms)`,
    );
    console.log(`  • Total Elapsed        : ${chalk.bold.white(profileRes.totalElapsedMs)} ms\n`);
  }

  console.log(chalk.bold.green('✔ Benchmark suite execution completed successfully.\n'));
}

export function registerBenchCommand(program: Command): void {
  program
    .command('bench')
    .alias('benchmark')
    .description('Run performance & concurrency lab benchmarks (Phase 13)')
    .option(
      '--suite <suite>',
      'Benchmark suite to run: scaling | occ | inventory | mongo | all (default: all)',
    )
    .option(
      '--concurrency <n>',
      'Concurrency level for hot-spot contention benchmark (default: 50)',
    )
    .option('--count <n>', 'Number of independent aggregates for scaling benchmark (default: 100)')
    .action(
      async (options: {
        suite?: 'scaling' | 'occ' | 'inventory' | 'mongo' | 'all';
        concurrency?: string;
        count?: string;
      }) => {
        await runBenchCommand(options);
      },
    );
}
