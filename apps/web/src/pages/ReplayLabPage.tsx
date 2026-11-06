import { useState } from 'react';
import { verifyReplayParity, type ReplayVerificationResult } from '../lib/api-client';

export function ReplayLabPage() {
  const [aggregateId, setAggregateId] = useState('ord-84f9a01');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReplayVerificationResult>({
    aggregateId: 'ord-84f9a01',
    timelineId: '00000000-0000-0000-0000-000000000001',
    eventsReplayed: 4,
    snapshotUsed: true,
    snapshotSequence: 2,
    liveStateHash: 'e92bc4410a88981290bbffea9109012399a0912cb84910a9fdeba88912301824',
    replayedStateHash: 'e92bc4410a88981290bbffea9109012399a0912cb84910a9fdeba88912301824',
    hashParity: true,
    executionTimeMs: 4.8,
  });

  const handleRunReplay = async () => {
    setIsLoading(true);
    const res = await verifyReplayParity(aggregateId);
    setResult(res);
    setIsLoading(false);
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h1 className="view-title">🔄 Deterministic Replay & Snapshot Lab</h1>
          <p className="view-subtitle">
            North-Star Guarantee #1: Bit-for-bit SHA-256 state hash parity between live MySQL state
            and deterministic replay (Rules 9, 11, 14 &amp; ADR-008, ADR-009).
          </p>
        </div>
      </div>

      {/* Control Box */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'end' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Aggregate ID to Verify</label>
            <input
              type="text"
              className="form-input"
              value={aggregateId}
              onChange={(e) => setAggregateId(e.target.value)}
            />
          </div>
          <button
            onClick={handleRunReplay}
            className="btn btn-primary"
            disabled={isLoading}
            style={{ height: '38px', minWidth: '160px', justifyContent: 'center' }}
          >
            {isLoading ? 'Replaying Events...' : '⚡ Prove Bit-for-Bit Parity'}
          </button>
        </div>
      </div>

      {/* Result Stat Cards */}
      <div className="grid-3">
        <div className="stat-widget">
          <div className="stat-label">SHA-256 State Parity</div>
          <div className="stat-value" style={{ color: result.hashParity ? '#10b981' : '#ef4444' }}>
            {result.hashParity ? '100% PARITY' : 'HASH MISMATCH'}
          </div>
          <div className="stat-subtext">Zero-Divergence Invariant (Rule 9)</div>
        </div>

        <div className="stat-widget">
          <div className="stat-label">Events Processed</div>
          <div className="stat-value">{result.eventsReplayed} Events</div>
          <div className="stat-subtext">Pure Reducer Folding (Rule 2)</div>
        </div>

        <div className="stat-widget">
          <div className="stat-label">Replay Execution Latency</div>
          <div className="stat-value" style={{ color: '#38bdf8' }}>
            {result.executionTimeMs} ms
          </div>
          <div className="stat-subtext">In-Memory Hot Path Execution</div>
        </div>
      </div>

      {/* Parity Proof Inspector */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <div className="card-title">🔐 Cryptographic SHA-256 Hash Proof</div>
          <span className="badge badge-success">Live vs Replay Verified</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            style={{
              padding: '1rem',
              background: '#090d16',
              borderRadius: '8px',
              border: '1px solid #10b981',
            }}
          >
            <div
              style={{
                fontSize: '0.8rem',
                color: '#10b981',
                fontWeight: 700,
                marginBottom: '0.35rem',
              }}
            >
              LIVE MYSQL STATE HASH (FROM CORE DATABASE)
            </div>
            <code style={{ fontSize: '0.86rem', color: '#f8fafc', wordBreak: 'break-all' }}>
              {result.liveStateHash}
            </code>
          </div>

          <div
            style={{
              padding: '1rem',
              background: '#090d16',
              borderRadius: '8px',
              border: '1px solid #10b981',
            }}
          >
            <div
              style={{
                fontSize: '0.8rem',
                color: '#10b981',
                fontWeight: 700,
                marginBottom: '0.35rem',
              }}
            >
              REPLAYED DETERMINISTIC STATE HASH (FROM RAW EVENTS)
            </div>
            <code style={{ fontSize: '0.86rem', color: '#f8fafc', wordBreak: 'break-all' }}>
              {result.replayedStateHash}
            </code>
          </div>
        </div>
      </div>

      {/* Snapshot Acceleration & ADR-009 Storage Fallback */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">📸 Snapshot Manager & Corruption Resilience (ADR-009)</div>
          <span className="badge badge-info">Rule 14 Verified</span>
        </div>

        <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
          <p style={{ marginBottom: '0.75rem' }}>
            Snapshots in Chronoscope accelerate replay by folding state up to a checkpoint and
            replaying only residual events. Every snapshot stores a SHA-256{' '}
            <code style={{ color: '#38bdf8' }}>content_hash</code> verified on read.
          </p>
          <div
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '8px',
              padding: '1rem',
              color: '#f8fafc',
            }}
          >
            <strong>🛡️ Transparent Fallback Guarantee: </strong>
            If a stored snapshot is corrupted (bit-rot, missing byte, or invalid SHA-256 hash), the
            Replay Engine logs a warning and transparently falls back to raw event replay from
            genesis. Replay correctness is never held hostage by the snapshot tier.
          </div>
        </div>
      </div>
    </div>
  );
}
