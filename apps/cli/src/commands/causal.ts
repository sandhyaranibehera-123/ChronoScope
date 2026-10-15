import chalk from 'chalk';
import type { DomainEvent } from '@chronoscope/domain';
import {
  getMysqlPool,
  MySqlCausalRepository,
  MySqlTimelineRepository,
} from '@chronoscope/database';
import { CausalGraphEngine, type CausalEventProvider } from '@chronoscope/replay-engine';

export interface CausalCommandOptions {
  readonly event?: string | undefined;
  readonly direction?: 'upstream' | 'downstream' | 'both' | undefined;
  readonly workflow?: string | undefined;
  readonly timeline?: string | undefined;
  readonly explain?: string | undefined;
  readonly format?: 'text' | 'dot' | 'mermaid' | 'json' | undefined;
}

export async function causalCommand(options: CausalCommandOptions): Promise<void> {
  const format = options.format || 'text';

  if (!options.event && !options.workflow && !options.timeline && !options.explain) {
    console.error(
      chalk.red(
        'Error: Please specify an event (--event <id>), workflow (--workflow <id>), timeline (--timeline <id>), or explain target (--explain <id>).',
      ),
    );
    process.exit(1);
  }

  const pool = getMysqlPool();
  const causalRepo = new MySqlCausalRepository(pool);
  const timelineRepo = new MySqlTimelineRepository(pool);

  const provider: CausalEventProvider = {
    async getEventById(eventId: string) {
      const rec = await causalRepo.getEventById(eventId);
      if (!rec) return null;
      return rec as unknown as DomainEvent;
    },
    async getEventsByCorrelationId(correlationId: string) {
      const list = await causalRepo.getEventsByCorrelationId(correlationId);
      return list as unknown as readonly DomainEvent[];
    },
    async getEventsByTimelineId(timelineId: string) {
      const list = await causalRepo.getEventsByTimelineId(timelineId);
      return list as unknown as readonly DomainEvent[];
    },
    async getEventsByCausationId(causationId: string) {
      const list = await causalRepo.getEventsByCausationId(causationId);
      return list as unknown as readonly DomainEvent[];
    },
    async getAncestry(timelineId: string) {
      return timelineRepo.getAncestry(timelineId);
    },
  };

  const engine = new CausalGraphEngine(provider);

  try {
    if (options.explain) {
      console.log(chalk.bold.cyan(`\n🔍 CHRONOSCOPE Root-Cause Explanation Engine (Phase 8)`));
      console.log(chalk.gray(`Target Event ID: `) + chalk.white(options.explain));
      console.log();

      const explanation = await engine.explainRootCause(options.explain);

      console.log(chalk.bold.green(`📋 Narrative:`));
      console.log(`   ${explanation.narrative}\n`);

      console.log(
        chalk.bold.yellow(`⛓️ Causal Step Chain (${explanation.causalChain.length} steps):`),
      );
      for (let i = 0; i < explanation.causalChain.length; i++) {
        const step = explanation.causalChain[i]!;
        const arrow = i === 0 ? '  🌱 ' : '  ⬇️ ';
        console.log(
          `${arrow}[${i + 1}] ${chalk.bold(step.eventType)} (${step.aggregateType}:${step.aggregateId}) in timeline ${step.timelineId} [event_id: ${step.eventId}]`,
        );
      }
      console.log();
      return;
    }

    let graph;
    let title = '';

    if (options.workflow) {
      title = `Workflow Causal DAG (correlation_id: ${options.workflow})`;
      graph = await engine.buildWorkflowGraph(options.workflow);
    } else if (options.timeline) {
      title = `Timeline Causal Graph (timeline_id: ${options.timeline})`;
      graph = await engine.buildTimelineGraph(options.timeline);
    } else if (options.event) {
      const direction = options.direction || 'both';
      title = `Event Causal Trace (event_id: ${options.event}, direction: ${direction})`;
      graph = await engine.traceEvent(options.event, { direction });
    }

    if (!graph) return;

    if (format === 'json') {
      console.log(JSON.stringify(graph, null, 2));
      return;
    }

    if (format === 'dot') {
      console.log(engine.renderDot(graph));
      return;
    }

    if (format === 'mermaid') {
      console.log(engine.renderMermaid(graph));
      return;
    }

    // Default 'text'
    console.log(chalk.bold.cyan(`\n🕸️  CHRONOSCOPE Causal Graph Engine (Phase 8)`));
    console.log(chalk.gray(`Scope: `) + chalk.white(title));
    console.log();
    console.log(engine.renderAscii(graph));
    console.log();
  } catch (err) {
    console.error(
      chalk.red(
        `\n❌ Causal graph command failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    process.exit(1);
  }
}
