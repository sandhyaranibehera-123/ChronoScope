import type { DomainEvent } from '@chronoscope/domain';
import type {
  CausalChainStep,
  CausalCycleReport,
  CausalEventProvider,
  CausalGraph,
  CausalGraphEdge,
  CausalGraphMetrics,
  CausalGraphNode,
  CausationEdge,
  RootCauseExplanation,
  TimelineAncestryEdge,
  TraversalOptions,
  WorkflowEdge,
} from './types.js';

interface RawEventLike {
  id?: string | undefined;
  event_id?: string | undefined;
  eventId?: string | undefined;
  timeline_id?: string | undefined;
  timelineId?: string | undefined;
  timeline_position?: number | string | undefined;
  timelinePosition?: number | string | undefined;
  aggregate_id?: string | undefined;
  aggregateId?: string | undefined;
  aggregate_type?: string | undefined;
  aggregateType?: string | undefined;
  aggregate_sequence?: number | string | undefined;
  aggregateSequence?: number | string | undefined;
  event_type?: string | undefined;
  eventType?: string | undefined;
  schema_version?: number | string | undefined;
  schemaVersion?: number | string | undefined;
  event_hash?: string | undefined;
  eventHash?: string | undefined;
  causation_id?: string | null | undefined;
  causationId?: string | null | undefined;
  correlation_id?: string | undefined;
  correlationId?: string | undefined;
  command_id?: string | null | undefined;
  commandId?: string | null | undefined;
  recorded_at?: string | undefined;
  recordedAt?: string | undefined;
  payload?: unknown;
}

/**
 * Normalizes any DomainEvent or database row into a canonical CausalGraphNode.
 */
export function toCausalGraphNode(event: unknown): CausalGraphNode {
  const e = (event || {}) as RawEventLike;

  const id = String(e.id || e.event_id || e.eventId || '');
  const timelineId = String(e.timeline_id || e.timelineId || '');
  const timelinePosition = Number(e.timeline_position ?? e.timelinePosition ?? 0);
  const aggregateId = String(e.aggregate_id || e.aggregateId || '');
  const aggregateType = String(e.aggregate_type || e.aggregateType || '');
  const aggregateSequence = Number(e.aggregate_sequence ?? e.aggregateSequence ?? 0);
  const eventType = String(e.event_type || e.eventType || '');
  const schemaVersion = Number(e.schema_version ?? e.schemaVersion ?? 1);
  const eventHash = String(e.event_hash || e.eventHash || '');
  const causationId =
    e.causation_id !== undefined
      ? e.causation_id
      : e.causationId !== undefined
        ? e.causationId
        : null;
  const correlationId = String(e.correlation_id || e.correlationId || '');
  const commandId =
    e.command_id !== undefined ? e.command_id : e.commandId !== undefined ? e.commandId : null;
  const recordedAt = String(e.recorded_at || e.recordedAt || new Date().toISOString());

  let payloadSummary: string | undefined;
  if (e.payload) {
    try {
      const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
      if (typeof p === 'object' && p !== null) {
        const record = p as Record<string, unknown>;
        const keys = Object.keys(record);
        payloadSummary = keys
          .slice(0, 3)
          .map((k) => `${k}:${String(record[k])}`)
          .join(', ');
      }
    } catch {
      payloadSummary = undefined;
    }
  }

  return {
    id,
    timelineId,
    timelinePosition,
    aggregateId,
    aggregateType,
    aggregateSequence,
    eventType,
    schemaVersion,
    eventHash,
    causationId,
    correlationId,
    commandId,
    recordedAt,
    payloadSummary,
  };
}

/**
 * Causal Graph Engine (Phase 8, Rules 5, 12, 24).
 *
 * Implements deterministic, cycle-safe graph traversal over authoritative events:
 * - Upstream traversal (root cause analysis via causation_id)
 * - Downstream traversal (blast radius / consequence analysis)
 * - Multi-aggregate workflow DAGs (correlation_id)
 * - Timeline fork ancestry links (TimelineAncestryEdge)
 * - Cycle detection and prevention (Rule 24 cycle-safety)
 */
export class CausalGraphEngine {
  constructor(private readonly provider: CausalEventProvider) {}

  /**
   * Traces causality around a given event (upstream, downstream, or both).
   */
  public async traceEvent(eventId: string, options: TraversalOptions = {}): Promise<CausalGraph> {
    const direction = options.direction ?? 'both';

    if (direction === 'upstream') {
      return this.traceUpstream(eventId, options);
    }
    if (direction === 'downstream') {
      return this.traceDownstream(eventId, options);
    }

    // Both directions
    const [upstream, downstream] = await Promise.all([
      this.traceUpstream(eventId, options),
      this.traceDownstream(eventId, options),
    ]);

    return this.mergeGraphs(upstream, downstream);
  }

  /**
   * Root-cause analysis: follows causation_id links backwards to genesis.
   * Cycle-safe: detects cycles and terminates traversal without infinite recursion.
   */
  public async traceUpstream(
    eventId: string,
    options: TraversalOptions = {},
  ): Promise<CausalGraph> {
    const maxDepth = options.maxDepth ?? 50;
    const nodes: Record<string, CausalGraphNode> = {};
    const edges: CausalGraphEdge[] = [];
    const rootEventIds: string[] = [];
    const visited = new Set<string>();
    const activePath = new Set<string>();
    const cycles: CausalCycleReport[] = [];
    let cycleDetected = false;

    const traverse = async (currentId: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;

      if (activePath.has(currentId)) {
        cycleDetected = true;
        cycles.push({ path: [...activePath, currentId] });
        return;
      }

      if (visited.has(currentId)) return;

      visited.add(currentId);
      activePath.add(currentId);

      const rawEvent = await this.provider.getEventById(currentId);
      if (!rawEvent) {
        activePath.delete(currentId);
        return;
      }

      const node = toCausalGraphNode(rawEvent);
      nodes[node.id] = node;

      if (!node.causationId) {
        if (!rootEventIds.includes(node.id)) {
          rootEventIds.push(node.id);
        }
      } else {
        const parentId = node.causationId;
        const causationEdge: CausationEdge = {
          type: 'CAUSATION',
          source: parentId,
          target: node.id,
        };
        edges.push(causationEdge);

        await traverse(parentId, depth + 1);
      }

      activePath.delete(currentId);
    };

    await traverse(eventId, 0);

    // If no explicit causationId === null node was reached, mark earliest visited as root
    if (rootEventIds.length === 0 && Object.keys(nodes).length > 0) {
      const earliest = Object.values(nodes).sort(
        (a, b) => a.timelinePosition - b.timelinePosition,
      )[0];
      if (earliest) rootEventIds.push(earliest.id);
    }

    const metrics = this.computeMetrics(nodes, edges);
    return {
      rootEventIds,
      nodes,
      edges,
      cycleDetected,
      cycles: cycles.length > 0 ? cycles : undefined,
      metrics,
    };
  }

  /**
   * Consequence / Blast-radius analysis: follows causation_id links forwards.
   * Cycle-safe: detects cycles and terminates traversal without infinite recursion.
   */
  public async traceDownstream(
    eventId: string,
    options: TraversalOptions = {},
  ): Promise<CausalGraph> {
    const maxDepth = options.maxDepth ?? 50;
    const nodes: Record<string, CausalGraphNode> = {};
    const edges: CausalGraphEdge[] = [];
    const rootEventIds: string[] = [eventId];
    const visited = new Set<string>();
    const activePath = new Set<string>();
    const cycles: CausalCycleReport[] = [];
    let cycleDetected = false;

    // Load root node first
    const rootRaw = await this.provider.getEventById(eventId);
    if (rootRaw) {
      nodes[eventId] = toCausalGraphNode(rootRaw);
    }

    const traverse = async (currentId: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;

      if (activePath.has(currentId)) {
        cycleDetected = true;
        cycles.push({ path: [...activePath, currentId] });
        return;
      }

      if (visited.has(currentId)) return;

      visited.add(currentId);
      activePath.add(currentId);

      // Fetch direct children where causation_id = currentId
      let children: readonly DomainEvent[] = [];
      if (this.provider.getEventsByCausationId) {
        children = await this.provider.getEventsByCausationId(currentId);
      } else if (this.provider.getAllEvents) {
        const all = await this.provider.getAllEvents();
        children = all.filter((ev) => {
          const e = ev as unknown as RawEventLike;
          return (e.causation_id || e.causationId) === currentId;
        });
      }

      for (const childRaw of children) {
        const childNode = toCausalGraphNode(childRaw);
        nodes[childNode.id] = childNode;

        const causationEdge: CausationEdge = {
          type: 'CAUSATION',
          source: currentId,
          target: childNode.id,
        };
        edges.push(causationEdge);

        await traverse(childNode.id, depth + 1);
      }

      activePath.delete(currentId);
    };

    await traverse(eventId, 0);

    const metrics = this.computeMetrics(nodes, edges);
    return {
      rootEventIds,
      nodes,
      edges,
      cycleDetected,
      cycles: cycles.length > 0 ? cycles : undefined,
      metrics,
    };
  }

  /**
   * Constructs the full causal DAG for a multi-aggregate workflow (correlation_id).
   * Incorporates both direct CausationEdge links and cross-aggregate WorkflowEdge links.
   */
  public async buildWorkflowGraph(
    correlationId: string,
    options: TraversalOptions = {},
  ): Promise<CausalGraph> {
    const rawEvents = await this.provider.getEventsByCorrelationId(correlationId);
    const nodes: Record<string, CausalGraphNode> = {};
    const edges: CausalGraphEdge[] = [];
    const rootEventIds: string[] = [];

    const sortedEvents = rawEvents
      .map(toCausalGraphNode)
      .sort((a, b) => a.timelinePosition - b.timelinePosition);

    for (const node of sortedEvents) {
      nodes[node.id] = node;
    }

    // 1. Direct causation edges within the workflow
    const causationMap = new Map<string, string>(); // childId -> parentId
    for (const node of sortedEvents) {
      if (node.causationId && nodes[node.causationId]) {
        edges.push({
          type: 'CAUSATION',
          source: node.causationId,
          target: node.id,
        });
        causationMap.set(node.id, node.causationId);
      } else if (!node.causationId) {
        rootEventIds.push(node.id);
      }
    }

    // 2. Cross-aggregate workflow edges (if enabled)
    if (options.includeWorkflowEdges !== false) {
      for (let i = 0; i < sortedEvents.length - 1; i++) {
        const current = sortedEvents[i]!;
        const next = sortedEvents[i + 1]!;

        // Add workflow edge when transitioning between different aggregates
        if (current.aggregateId !== next.aggregateId) {
          const workflowEdge: WorkflowEdge = {
            type: 'WORKFLOW',
            source: current.id,
            target: next.id,
            metadata: {
              correlationId,
              stepOrder: i + 1,
            },
          };
          edges.push(workflowEdge);
        }
      }
    }

    if (rootEventIds.length === 0 && sortedEvents.length > 0) {
      rootEventIds.push(sortedEvents[0]!.id);
    }

    // Check for cycles in the constructed workflow edges
    const cycleReport = this.detectCycles(nodes, edges);

    const metrics = this.computeMetrics(nodes, edges);
    return {
      rootEventIds,
      nodes,
      edges,
      cycleDetected: cycleReport.detected,
      cycles: cycleReport.cycles.length > 0 ? cycleReport.cycles : undefined,
      metrics,
    };
  }

  /**
   * Constructs the causal graph for a specific timeline, including
   * TimelineAncestryEdge links across fork boundaries if ancestry is available.
   */
  public async buildTimelineGraph(
    timelineId: string,
    options: TraversalOptions = {},
  ): Promise<CausalGraph> {
    let rawEvents: readonly DomainEvent[] = [];
    if (this.provider.getEventsByTimelineId) {
      rawEvents = await this.provider.getEventsByTimelineId(timelineId);
    } else if (this.provider.getAllEvents) {
      const all = await this.provider.getAllEvents();
      rawEvents = all.filter((ev) => {
        const e = ev as unknown as RawEventLike;
        return (e.timeline_id || e.timelineId) === timelineId;
      });
    }

    const nodes: Record<string, CausalGraphNode> = {};
    const edges: CausalGraphEdge[] = [];
    const rootEventIds: string[] = [];

    const sortedEvents = rawEvents
      .map(toCausalGraphNode)
      .sort((a, b) => a.timelinePosition - b.timelinePosition);

    for (const node of sortedEvents) {
      nodes[node.id] = node;
    }

    // Connect causation edges
    for (const node of sortedEvents) {
      if (node.causationId && nodes[node.causationId]) {
        edges.push({
          type: 'CAUSATION',
          source: node.causationId,
          target: node.id,
        });
      } else if (!node.causationId) {
        rootEventIds.push(node.id);
      }
    }

    // Connect timeline ancestry edge if this is a branch timeline
    if (options.includeAncestryEdges !== false && this.provider.getAncestry) {
      const ancestry = await this.provider.getAncestry(timelineId);
      const currentNode = ancestry.find((n) => n.timelineId === timelineId);

      if (currentNode && currentNode.parentTimelineId) {
        // Find parent timeline's event at or nearest forkPosition
        let parentEvents: readonly DomainEvent[] = [];
        if (this.provider.getEventsByTimelineId) {
          parentEvents = await this.provider.getEventsByTimelineId(currentNode.parentTimelineId);
        }

        const parentAtFork = parentEvents
          .map(toCausalGraphNode)
          .filter((e) => e.timelinePosition <= currentNode.forkPosition)
          .sort((a, b) => b.timelinePosition - a.timelinePosition)[0];

        const firstBranchEvent = sortedEvents[0];

        if (parentAtFork && firstBranchEvent) {
          nodes[parentAtFork.id] = parentAtFork;
          const ancestryEdge: TimelineAncestryEdge = {
            type: 'TIMELINE_ANCESTRY',
            source: parentAtFork.id,
            target: firstBranchEvent.id,
            metadata: {
              parentTimelineId: currentNode.parentTimelineId,
              branchTimelineId: timelineId,
              forkPosition: currentNode.forkPosition,
            },
          };
          edges.push(ancestryEdge);
          if (!rootEventIds.includes(parentAtFork.id)) {
            rootEventIds.unshift(parentAtFork.id);
          }
        }
      }
    }

    if (rootEventIds.length === 0 && sortedEvents.length > 0) {
      rootEventIds.push(sortedEvents[0]!.id);
    }

    const cycleReport = this.detectCycles(nodes, edges);
    const metrics = this.computeMetrics(nodes, edges);

    return {
      rootEventIds,
      nodes,
      edges,
      cycleDetected: cycleReport.detected,
      cycles: cycleReport.cycles.length > 0 ? cycleReport.cycles : undefined,
      metrics,
    };
  }

  /**
   * Explains root cause of a specific event (e.g. OrderCancelled or PaymentFailed).
   */
  public async explainRootCause(eventId: string): Promise<RootCauseExplanation> {
    const upstream = await this.traceUpstream(eventId);
    const target = upstream.nodes[eventId];

    if (!target) {
      throw new Error(`Event not found in causal history: ${eventId}`);
    }

    const causalChain: CausalChainStep[] = [];
    let current: CausalGraphNode | undefined = target;
    const visited = new Set<string>();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      causalChain.unshift({
        eventId: current.id,
        eventType: current.eventType,
        aggregateType: current.aggregateType,
        aggregateId: current.aggregateId,
        timelineId: current.timelineId,
      });

      if (!current.causationId) break;
      current = upstream.nodes[current.causationId];
    }

    const rootStep = causalChain[0]!;
    const immediateCause =
      causalChain.length > 1
        ? {
            eventId: causalChain[causalChain.length - 2]!.eventId,
            eventType: causalChain[causalChain.length - 2]!.eventType,
          }
        : null;

    let narrative = `Event '${target.eventType}' (${target.aggregateType}:${target.aggregateId})`;
    if (immediateCause) {
      narrative += ` was directly caused by '${immediateCause.eventType}' (${immediateCause.eventId})`;
    }
    narrative += `, originating from root event '${rootStep.eventType}' (${rootStep.eventId}) in timeline '${rootStep.timelineId}'.`;

    return {
      targetEventId: target.id,
      targetEventType: target.eventType,
      rootEventId: rootStep.eventId,
      rootEventType: rootStep.eventType,
      causalChain,
      immediateCause,
      narrative,
    };
  }

  /**
   * Renders the causal graph into human-readable ASCII tree format.
   */
  public renderAscii(graph: CausalGraph): string {
    const lines: string[] = [];

    if (graph.cycleDetected) {
      lines.push(
        '⚠️  WARNING: CYCLE DETECTED IN CAUSAL GRAPH (Rule 24 Cycle-Safety Guard Triggered)',
      );
      if (graph.cycles) {
        for (const c of graph.cycles) {
          lines.push(`   Cycle path: ${c.path.join(' -> ')}`);
        }
      }
      lines.push('');
    }

    lines.push(
      `Causal Graph: ${graph.metrics.totalNodes} nodes, ${graph.metrics.totalEdges} edges (${graph.metrics.causationEdges} causation, ${graph.metrics.workflowEdges} workflow, ${graph.metrics.timelineAncestryEdges} ancestry)`,
    );
    lines.push('─'.repeat(80));

    // Map children by source node id
    const childMap = new Map<string, Array<{ targetId: string; type: string }>>();
    for (const edge of graph.edges) {
      if (!childMap.has(edge.source)) {
        childMap.set(edge.source, []);
      }
      childMap.get(edge.source)!.push({ targetId: edge.target, type: edge.type });
    }

    const visited = new Set<string>();

    const printNode = (
      nodeId: string,
      prefix: string,
      isLast: boolean,
      edgeType?: string,
    ): void => {
      const node = graph.nodes[nodeId];
      const branch = isLast ? '└── ' : '├── ';
      const edgeLabel = edgeType ? `──(${edgeType})──> ` : '';

      if (!node) {
        lines.push(`${prefix}${branch}${edgeLabel}[Unknown Node: ${nodeId}]`);
        return;
      }

      const summary = node.payloadSummary ? ` [${node.payloadSummary}]` : '';
      lines.push(
        `${prefix}${branch}${edgeLabel}${node.eventType} (${node.aggregateType}:${node.aggregateId}) pos:${node.timelinePosition} seq:${node.aggregateSequence}${summary}`,
      );

      if (visited.has(nodeId)) {
        lines.push(
          `${prefix}${isLast ? '    ' : '│   '}└── [Already Visited / Cycle Point: ${nodeId}]`,
        );
        return;
      }

      visited.add(nodeId);

      const children = childMap.get(nodeId) || [];
      const newPrefix = prefix + (isLast ? '    ' : '│   ');

      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        printNode(child.targetId, newPrefix, i === children.length - 1, child.type);
      }
    };

    for (let i = 0; i < graph.rootEventIds.length; i++) {
      const rootId = graph.rootEventIds[i]!;
      printNode(rootId, '', i === graph.rootEventIds.length - 1);
    }

    return lines.join('\n');
  }

  /**
   * Renders the causal graph in Graphviz DOT format with styled edges.
   */
  public renderDot(graph: CausalGraph): string {
    const lines: string[] = [
      'digraph ChronoscopeCausalGraph {',
      '  rankdir=LR;',
      '  node [shape=box, style="rounded,filled", fontname="Helvetica"];',
      '  edge [fontname="Helvetica", fontsize=10];',
      '',
    ];

    // Colors per aggregate type
    const colors: Record<string, string> = {
      Order: '#dbeafe', // light blue
      Payment: '#fef3c7', // light amber
      Inventory: '#dcfce7', // light green
      Shipment: '#f3e8ff', // light purple
    };

    for (const [id, node] of Object.entries(graph.nodes)) {
      const fillColor = colors[node.aggregateType] || '#f3f4f6';
      const label = `${node.eventType}\\n${node.aggregateType}:${node.aggregateId}\\nseq:${node.aggregateSequence} pos:${node.timelinePosition}`;
      lines.push(`  "${id}" [label="${label}", fillcolor="${fillColor}"];`);
    }

    lines.push('');

    for (const edge of graph.edges) {
      let style = '';
      if (edge.type === 'CAUSATION') {
        style = 'color="#2563eb", style="bold", label="causation"';
      } else if (edge.type === 'TIMELINE_ANCESTRY') {
        style = 'color="#7c3aed", style="dashed", label="fork_ancestry"';
      } else if (edge.type === 'WORKFLOW') {
        style = 'color="#059669", style="dotted", label="workflow"';
      }

      lines.push(`  "${edge.source}" -> "${edge.target}" [${style}];`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Renders the causal graph in Mermaid format.
   */
  public renderMermaid(graph: CausalGraph): string {
    const lines: string[] = ['flowchart LR'];

    for (const [id, node] of Object.entries(graph.nodes)) {
      const safeId = id.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`  ${safeId}["${node.eventType}<br/>${node.aggregateType}:${node.aggregateId}"]`);
    }

    for (const edge of graph.edges) {
      const safeSrc = edge.source.replace(/[^a-zA-Z0-9]/g, '_');
      const safeTgt = edge.target.replace(/[^a-zA-Z0-9]/g, '_');

      if (edge.type === 'CAUSATION') {
        lines.push(`  ${safeSrc} ==>|causation| ${safeTgt}`);
      } else if (edge.type === 'TIMELINE_ANCESTRY') {
        lines.push(`  ${safeSrc} -.->|fork| ${safeTgt}`);
      } else if (edge.type === 'WORKFLOW') {
        lines.push(`  ${safeSrc} -->|workflow| ${safeTgt}`);
      }
    }

    return lines.join('\n');
  }

  private mergeGraphs(a: CausalGraph, b: CausalGraph): CausalGraph {
    const nodes: Record<string, CausalGraphNode> = { ...a.nodes, ...b.nodes };
    const edgeKey = (e: CausalGraphEdge) => `${e.type}:${e.source}:${e.target}`;
    const edgeMap = new Map<string, CausalGraphEdge>();

    for (const e of [...a.edges, ...b.edges]) {
      edgeMap.set(edgeKey(e), e);
    }

    const edges = Array.from(edgeMap.values());
    const rootSet = new Set<string>([...a.rootEventIds, ...b.rootEventIds]);
    const rootEventIds = Array.from(rootSet);

    const cycleDetected = a.cycleDetected || b.cycleDetected;
    const cycles = [...(a.cycles || []), ...(b.cycles || [])];

    const metrics = this.computeMetrics(nodes, edges);

    return {
      rootEventIds,
      nodes,
      edges,
      cycleDetected,
      cycles: cycles.length > 0 ? cycles : undefined,
      metrics,
    };
  }

  private detectCycles(
    nodes: Record<string, CausalGraphNode>,
    edges: readonly CausalGraphEdge[],
  ): { detected: boolean; cycles: CausalCycleReport[] } {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    }

    const visited = new Set<string>();
    const active = new Set<string>();
    const cycles: CausalCycleReport[] = [];
    let detected = false;

    const dfs = (nodeId: string, path: string[]) => {
      if (active.has(nodeId)) {
        detected = true;
        cycles.push({ path: [...path, nodeId] });
        return;
      }
      if (visited.has(nodeId)) return;

      visited.add(nodeId);
      active.add(nodeId);

      const neighbors = adj.get(nodeId) || [];
      for (const next of neighbors) {
        dfs(next, [...path, nodeId]);
      }

      active.delete(nodeId);
    };

    for (const nodeId of Object.keys(nodes)) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, []);
      }
    }

    return { detected, cycles };
  }

  private computeMetrics(
    nodes: Record<string, CausalGraphNode>,
    edges: readonly CausalGraphEdge[],
  ): CausalGraphMetrics {
    const totalNodes = Object.keys(nodes).length;
    const totalEdges = edges.length;

    let causationEdges = 0;
    let timelineAncestryEdges = 0;
    let workflowEdges = 0;

    for (const e of edges) {
      if (e.type === 'CAUSATION') causationEdges++;
      else if (e.type === 'TIMELINE_ANCESTRY') timelineAncestryEdges++;
      else if (e.type === 'WORKFLOW') workflowEdges++;
    }

    const aggregates = new Set<string>();
    const timelines = new Set<string>();
    for (const n of Object.values(nodes)) {
      aggregates.add(`${n.timelineId}:${n.aggregateId}`);
      timelines.add(n.timelineId);
    }

    const branchingFactor = totalNodes > 0 ? Number((totalEdges / totalNodes).toFixed(2)) : 0;

    return {
      totalNodes,
      totalEdges,
      causationEdges,
      timelineAncestryEdges,
      workflowEdges,
      maxDepth: 0, // dynamic depth can be calculated via longest path if needed
      branchingFactor,
      aggregateCount: aggregates.size,
      timelineCount: timelines.size,
    };
  }
}
