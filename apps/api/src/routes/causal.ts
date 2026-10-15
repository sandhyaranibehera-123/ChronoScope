import type { FastifyPluginAsync } from 'fastify';
import { causalEventQuerySchema, causalWorkflowQuerySchema } from '@chronoscope/contracts';
import type { CausalGraphEngine } from '@chronoscope/replay-engine';

export interface CausalRoutesOptions {
  causalGraphEngine?: CausalGraphEngine | undefined;
}

export const causalRoutes: FastifyPluginAsync<CausalRoutesOptions> = async (fastify, options) => {
  const engine = options.causalGraphEngine;

  /**
   * GET /api/v1/causal/events/:eventId
   * Traces causality around a specific event (upstream root cause, downstream blast radius, or both).
   */
  fastify.get<{
    Params: { eventId: string };
    Querystring: { direction?: string; maxDepth?: string; format?: string };
  }>('/api/v1/causal/events/:eventId', async (request, reply) => {
    if (!engine) {
      return reply.status(503).send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'CausalGraphEngine is not configured in API dependencies',
      });
    }

    const query = causalEventQuerySchema.parse({
      direction: request.query.direction,
      maxDepth: request.query.maxDepth,
      format: request.query.format,
    });

    const graph = await engine.traceEvent(request.params.eventId, {
      direction: query.direction,
      maxDepth: query.maxDepth,
    });

    if (query.format === 'ascii') {
      reply.type('text/plain');
      return engine.renderAscii(graph);
    }
    if (query.format === 'dot') {
      reply.type('text/plain');
      return engine.renderDot(graph);
    }
    if (query.format === 'mermaid') {
      reply.type('text/plain');
      return engine.renderMermaid(graph);
    }

    return graph;
  });

  /**
   * GET /api/v1/causal/events/:eventId/root-cause
   * Explains root cause narrative and causal step chain for an event.
   */
  fastify.get<{
    Params: { eventId: string };
  }>('/api/v1/causal/events/:eventId/root-cause', async (request, reply) => {
    if (!engine) {
      return reply.status(503).send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'CausalGraphEngine is not configured in API dependencies',
      });
    }

    try {
      const explanation = await engine.explainRootCause(request.params.eventId);
      return explanation;
    } catch (err) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * GET /api/v1/causal/workflows/:correlationId
   * Constructs the multi-aggregate causal DAG for a workflow.
   */
  fastify.get<{
    Params: { correlationId: string };
    Querystring: { format?: string };
  }>('/api/v1/causal/workflows/:correlationId', async (request, reply) => {
    if (!engine) {
      return reply.status(503).send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'CausalGraphEngine is not configured in API dependencies',
      });
    }

    const query = causalWorkflowQuerySchema.parse({
      format: request.query.format,
    });

    const graph = await engine.buildWorkflowGraph(request.params.correlationId);

    if (query.format === 'ascii') {
      reply.type('text/plain');
      return engine.renderAscii(graph);
    }
    if (query.format === 'dot') {
      reply.type('text/plain');
      return engine.renderDot(graph);
    }
    if (query.format === 'mermaid') {
      reply.type('text/plain');
      return engine.renderMermaid(graph);
    }

    return graph;
  });

  /**
   * GET /api/v1/causal/timelines/:timelineId
   * Constructs the causal graph of events in a timeline, including fork ancestry links.
   */
  fastify.get<{
    Params: { timelineId: string };
    Querystring: { format?: string };
  }>('/api/v1/causal/timelines/:timelineId', async (request, reply) => {
    if (!engine) {
      return reply.status(503).send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'CausalGraphEngine is not configured in API dependencies',
      });
    }

    const query = causalWorkflowQuerySchema.parse({
      format: request.query.format,
    });

    const graph = await engine.buildTimelineGraph(request.params.timelineId);

    if (query.format === 'ascii') {
      reply.type('text/plain');
      return engine.renderAscii(graph);
    }
    if (query.format === 'dot') {
      reply.type('text/plain');
      return engine.renderDot(graph);
    }
    if (query.format === 'mermaid') {
      reply.type('text/plain');
      return engine.renderMermaid(graph);
    }

    return graph;
  });
};
