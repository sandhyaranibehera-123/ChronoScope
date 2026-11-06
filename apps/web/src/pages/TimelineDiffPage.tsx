import { useState } from 'react';
import { fetchTimelineDiff, type TimelineDiffResult } from '../lib/api-client';

export function TimelineDiffPage() {
  const [baseTimelineId, setBaseTimelineId] = useState('00000000-0000-0000-0000-000000000001');
  const [branchTimelineId, setBranchTimelineId] = useState('branch-counterfactual');
  const [aggregateId, setAggregateId] = useState('ord-demo-100');
  const [isLoading, setIsLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<TimelineDiffResult>({
    commonAncestor: 'MAIN',
    forkPosition: 2,
    hashesMatch: false,
    baseState: {
      status: 'PAID',
      items: [{ sku: 'SKU-LAPTOP-DEV', quantity: 1, amountMinor: 50000 }],
      totalAmountMinor: 50000,
      currency: 'USD',
      stateHash: '7a19c3b889e0fa41d7c2b51239aa8e1049c682390a18bc01d94827bbca801824',
    },
    branchState: {
      status: 'CANCELLED',
      items: [{ sku: 'SKU-LAPTOP-DEV', quantity: 1, amountMinor: 50000 }],
      totalAmountMinor: 50000,
      currency: 'USD',
      stateHash: '8f0012bc5564de0911ab6789cda109841805bbca39109acbc390192809feca81',
    },
    divergenceReason:
      "ScenarioInput 'ForcePaymentFailure' induced payment failure on branch, triggering backward saga compensation.",
    baseEvents: [
      { eventId: 'ev-main-3', type: 'OrderPaid', pos: 3 },
      { eventId: 'ev-main-4', type: 'OrderShipped', pos: 4 },
    ],
    branchEvents: [
      { eventId: 'ev-branch-1', type: 'PaymentFailed', pos: 3 },
      { eventId: 'ev-branch-2', type: 'InventoryReleased', pos: 4 },
      { eventId: 'ev-branch-3', type: 'OrderCancelled', pos: 5 },
    ],
  });

  const handleCompare = async () => {
    setIsLoading(true);
    const res = await fetchTimelineDiff(baseTimelineId, branchTimelineId, aggregateId);
    setDiffResult(res);
    setIsLoading(false);
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h1 className="view-title">🌿 Timeline DAG & Counterfactual Diff Studio</h1>
          <p className="view-subtitle">
            Zero-copy timeline branching, ancestor traversal via recursive SQL, and counterfactual
            state diffing (Phase 7, Rules 6, 9, 12, 13).
          </p>
        </div>
      </div>

      {/* Control Configuration Bar */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr) auto',
            gap: '1rem',
            alignItems: 'end',
          }}
        >
          <div>
            <label className="form-label">Base Timeline (A)</label>
            <input
              type="text"
              className="form-input"
              value={baseTimelineId}
              onChange={(e) => setBaseTimelineId(e.target.value)}
            />
          </div>

          <div>
            <label className="form-label">Branch Timeline (B)</label>
            <input
              type="text"
              className="form-input"
              value={branchTimelineId}
              onChange={(e) => setBranchTimelineId(e.target.value)}
            />
          </div>

          <div>
            <label className="form-label">Aggregate ID</label>
            <input
              type="text"
              className="form-input"
              value={aggregateId}
              onChange={(e) => setAggregateId(e.target.value)}
            />
          </div>

          <button
            onClick={handleCompare}
            className="btn btn-primary"
            disabled={isLoading}
            style={{ height: '38px', minWidth: '120px', justifyContent: 'center' }}
          >
            {isLoading ? 'Computing Diff...' : '⚡ Compare DAG'}
          </button>
        </div>
      </div>

      {/* DAG Metadata Status Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1rem',
          padding: '1.25rem',
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '10px',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <div className="stat-label" style={{ color: '#38bdf8' }}>
            Nearest Common Ancestor
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {diffResult.commonAncestor}
          </div>
        </div>

        <div>
          <div className="stat-label" style={{ color: '#38bdf8' }}>
            Branch Fork Position
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.2rem' }}>
            Position #{diffResult.forkPosition} (Zero-Copy)
          </div>
        </div>

        <div>
          <div className="stat-label" style={{ color: '#38bdf8' }}>
            State Hash Status
          </div>
          <div style={{ marginTop: '0.35rem' }}>
            <span className={`badge ${diffResult.hashesMatch ? 'badge-success' : 'badge-danger'}`}>
              {diffResult.hashesMatch ? '✔ HASH PARITY (IDENTICAL)' : '✖ DIVERGED (COUNTERFACTUAL)'}
            </span>
          </div>
        </div>
      </div>

      {/* Divergence Alert Box */}
      <div
        style={{
          padding: '1rem 1.25rem',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          color: '#fbbf24',
          fontSize: '0.9rem',
        }}
      >
        <strong>🔬 Causal Divergence Reason: </strong>
        {diffResult.divergenceReason}
      </div>

      {/* Side-by-Side Comparison */}
      <div className="grid-2">
        {/* Base Timeline Card */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <span>🔵 Base Timeline (MAIN)</span>
            </div>
            <span className="badge badge-success">Production Path</span>
          </div>

          <div
            style={{
              padding: '1rem',
              background: '#0f172a',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ marginBottom: '0.4rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Status: </span>
              <span className="badge badge-success">{String(diffResult.baseState['status'])}</span>
            </div>
            <div style={{ marginBottom: '0.4rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total Amount: </span>
              <strong>${Number(diffResult.baseState['totalAmountMinor']) / 100} USD</strong>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', wordBreak: 'break-all' }}>
              <span style={{ color: 'var(--text-muted)' }}>SHA-256 State Hash: </span>
              <code>{String(diffResult.baseState['stateHash'] ?? '7a19c3b889e0...')}</code>
            </div>
          </div>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.65rem' }}>
            Diverging Events on Base:
          </h3>
          <ul style={{ listStyle: 'none' }}>
            {diffResult.baseEvents.map((ev) => (
              <li
                key={ev.eventId}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  marginBottom: '0.45rem',
                  fontSize: '0.84rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  <strong style={{ color: '#34d399' }}>{ev.type}</strong>
                </span>
                <span className="badge badge-info">pos #{ev.pos}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Branch Timeline Card */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <span>🟣 Counterfactual Branch</span>
            </div>
            <span className="badge badge-danger">Compensated Saga</span>
          </div>

          <div
            style={{
              padding: '1rem',
              background: '#0f172a',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ marginBottom: '0.4rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Status: </span>
              <span className="badge badge-danger">{String(diffResult.branchState['status'])}</span>
            </div>
            <div style={{ marginBottom: '0.4rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total Amount: </span>
              <strong>${Number(diffResult.branchState['totalAmountMinor']) / 100} USD</strong>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', wordBreak: 'break-all' }}>
              <span style={{ color: 'var(--text-muted)' }}>SHA-256 State Hash: </span>
              <code>{String(diffResult.branchState['stateHash'] ?? '8f0012bc5564...')}</code>
            </div>
          </div>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.65rem' }}>
            Diverging Events on Branch:
          </h3>
          <ul style={{ listStyle: 'none' }}>
            {diffResult.branchEvents.map((ev) => (
              <li
                key={ev.eventId}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  marginBottom: '0.45rem',
                  fontSize: '0.84rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  <strong style={{ color: '#f87171' }}>{ev.type}</strong>
                </span>
                <span className="badge badge-warning">pos #{ev.pos}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
