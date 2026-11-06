import { useState } from 'react';
import { fetchCausalGraph, type CausalGraphResult } from '../lib/api-client';

export function CausalGraphPage() {
  const [aggregateId, setAggregateId] = useState('ord-84f9a01');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('node-pay');
  const [isLoading, setIsLoading] = useState(false);
  const [graphData, setGraphData] = useState<CausalGraphResult>({
    aggregateId: 'ord-84f9a01',
    hasCycles: false,
    blastRadiusCount: 3,
    rootCauseId: 'node-pay',
    nodes: [
      {
        id: 'node-create',
        label: 'OrderCreated',
        type: 'DomainEvent',
        timestamp: '14:20:00.100',
        status: 'success',
      },
      {
        id: 'node-reserve',
        label: 'InventoryReserved',
        type: 'DomainEvent',
        timestamp: '14:20:00.145',
        status: 'success',
      },
      {
        id: 'node-pay',
        label: 'PaymentFailed',
        type: 'FaultEvent',
        timestamp: '14:20:00.210',
        status: 'fault',
      },
      {
        id: 'node-comp-inv',
        label: 'InventoryReleased',
        type: 'Compensation',
        timestamp: '14:20:00.280',
        status: 'compensated',
      },
      {
        id: 'node-cancel',
        label: 'OrderCancelled',
        type: 'TerminalEvent',
        timestamp: '14:20:00.320',
        status: 'compensated',
      },
    ],
    edges: [
      { from: 'node-create', to: 'node-reserve', kind: 'CausationEdge' },
      { from: 'node-reserve', to: 'node-pay', kind: 'WorkflowEdge' },
      { from: 'node-pay', to: 'node-comp-inv', kind: 'WorkflowEdge' },
      { from: 'node-comp-inv', to: 'node-cancel', kind: 'CausationEdge' },
      { from: 'node-create', to: 'node-cancel', kind: 'TimelineAncestryEdge' },
    ],
  });

  const handleInspect = async () => {
    setIsLoading(true);
    const res = await fetchCausalGraph(aggregateId);
    setGraphData(res);
    setIsLoading(false);
  };

  const selectedNode = graphData.nodes.find((n) => n.id === selectedNodeId);

  return (
    <div>
      <div className="view-header">
        <div>
          <h1 className="view-title">🕸️ Causal Graph & Blast Radius Explorer</h1>
          <p className="view-subtitle">
            Causal DAG traversal, automated root cause diagnosis, blast radius analysis, and cycle
            safety (Phase 8, Rules 5, 12, 24).
          </p>
        </div>
      </div>

      {/* Top Search & Filter Bar */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'end' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Aggregate ID to Trace</label>
            <input
              type="text"
              className="form-input"
              value={aggregateId}
              onChange={(e) => setAggregateId(e.target.value)}
            />
          </div>
          <button
            onClick={handleInspect}
            className="btn btn-primary"
            disabled={isLoading}
            style={{ height: '38px', minWidth: '120px', justifyContent: 'center' }}
          >
            {isLoading ? 'Tracing...' : '🔍 Trace Causal DAG'}
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid-3">
        <div className="stat-widget">
          <div className="stat-label">Cycle-Safety Verification</div>
          <div className="stat-value" style={{ color: '#10b981', fontSize: '1.35rem' }}>
            {graphData.hasCycles ? '✖ Cycle Detected' : '✔ Proved Acyclic (DAG)'}
          </div>
          <div className="stat-subtext">Tarjan Cycle-Detection (Rule 24)</div>
        </div>

        <div className="stat-widget">
          <div className="stat-label">Blast Radius Count</div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>
            {graphData.blastRadiusCount} Nodes
          </div>
          <div className="stat-subtext">Downstream Cascading Compensations</div>
        </div>

        <div className="stat-widget">
          <div className="stat-label">Identified Root Cause</div>
          <div className="stat-value" style={{ color: '#ef4444', fontSize: '1.35rem' }}>
            {graphData.rootCauseId ? 'PaymentFailed' : 'None (Healthy)'}
          </div>
          <div className="stat-subtext">Automated Reverse Causation Path</div>
        </div>
      </div>

      {/* Causal Graph Interactive Node Canvas */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <div className="card-title">🌐 Interactive Causal Node Hierarchy</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <span className="badge badge-info">CausationEdge</span>
            <span className="badge badge-warning">WorkflowEdge</span>
            <span className="badge badge-success">TimelineAncestryEdge</span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '2.5rem 1.5rem',
            background: '#070b12',
            borderRadius: '10px',
            border: '1px solid var(--border)',
            position: 'relative',
            overflowX: 'auto',
          }}
        >
          {graphData.nodes.map((node, idx) => (
            <div
              key={node.id}
              onClick={() => setSelectedNodeId(node.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                cursor: 'pointer',
                zIndex: 2,
              }}
            >
              <div
                style={{
                  width: '130px',
                  padding: '0.85rem 0.5rem',
                  borderRadius: '10px',
                  textAlign: 'center',
                  background:
                    selectedNodeId === node.id
                      ? 'rgba(56, 189, 248, 0.25)'
                      : node.status === 'fault'
                        ? 'rgba(239, 68, 68, 0.15)'
                        : node.status === 'compensated'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(16, 185, 129, 0.15)',
                  border:
                    selectedNodeId === node.id
                      ? '2px solid #38bdf8'
                      : node.status === 'fault'
                        ? '1px solid rgba(239, 68, 68, 0.5)'
                        : node.status === 'compensated'
                          ? '1px solid rgba(245, 158, 11, 0.5)'
                          : '1px solid rgba(16, 185, 129, 0.5)',
                  boxShadow:
                    selectedNodeId === node.id ? '0 0 15px rgba(56, 189, 248, 0.4)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontSize: '1.2rem', marginBottom: '0.25rem' }}>
                  {node.status === 'fault' ? '💥' : node.status === 'compensated' ? '↩️' : '🟢'}
                </div>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#f8fafc' }}>
                  {node.label}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                  {node.timestamp}
                </div>
              </div>
              {idx < graphData.nodes.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    fontSize: '1rem',
                    color: 'var(--text-dim)',
                    transform: 'translateX(80px)',
                  }}
                >
                  ⟶
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Selected Node Inspector */}
      {selectedNode && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <span>🔎 Node Inspector: </span>
              <span style={{ color: '#38bdf8' }}>{selectedNode.label}</span>
            </div>
            <span
              className={`badge ${
                selectedNode.status === 'fault'
                  ? 'badge-danger'
                  : selectedNode.status === 'compensated'
                    ? 'badge-warning'
                    : 'badge-success'
              }`}
            >
              {selectedNode.status.toUpperCase()}
            </span>
          </div>

          <div className="grid-2">
            <div>
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Node ID: </span>
                <code>{selectedNode.id}</code>
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Event Classification: </span>
                <span className="badge badge-info">{selectedNode.type}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Causation Timestamp: </span>
                <code>{selectedNode.timestamp}</code>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <strong>Causal Edge Relationships:</strong>
                <ul style={{ paddingLeft: '1.25rem', marginTop: '0.4rem' }}>
                  {graphData.edges
                    .filter((e) => e.from === selectedNode.id || e.to === selectedNode.id)
                    .map((e, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        <code>{e.from}</code> ⟶ <code>{e.to}</code> ({e.kind})
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
