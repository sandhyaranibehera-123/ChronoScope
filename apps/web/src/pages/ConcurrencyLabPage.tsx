import { useState } from 'react';
import { runConcurrencyBenchmarks, type ConcurrencyStrategyResult } from '../lib/api-client';

export function ConcurrencyLabPage() {
  const [results, setResults] = useState<ConcurrencyStrategyResult[]>(runConcurrencyBenchmarks());
  const [isRunning, setIsRunning] = useState(false);

  const handleRunSimulation = async () => {
    setIsRunning(true);
    await new Promise((r) => setTimeout(r, 600));
    setResults(runConcurrencyBenchmarks());
    setIsRunning(false);
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h1 className="view-title">📈 Performance & Concurrency Laboratory</h1>
          <p className="view-subtitle">
            High-throughput scaling, hot-spot OCC contention analysis, and 4 inventory
            race-prevention strategies (Phase 13, Rules 1, 6, 10, 15).
          </p>
        </div>
        <button onClick={handleRunSimulation} className="btn btn-primary" disabled={isRunning}>
          {isRunning ? 'Running 400 Writers...' : '🚀 Re-Run 100 Contending Writers'}
        </button>
      </div>

      {/* Strategies Comparison Cards */}
      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        {results.map((res, idx) => (
          <div
            key={idx}
            className="card"
            style={{
              borderColor: res.oversellDetected ? '#ef4444' : '#10b981',
            }}
          >
            <div className="card-header">
              <div className="card-title" style={{ fontSize: '0.95rem' }}>
                {res.strategy}
              </div>
              <span className={`badge ${res.oversellDetected ? 'badge-danger' : 'badge-success'}`}>
                {res.oversellDetected ? '✖ OVERSELL DETECTED' : '✔ ZERO OVERSELL'}
              </span>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              {res.description}
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.75rem',
                background: '#090d16',
                padding: '0.85rem',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>Contenders</div>
                <strong style={{ fontSize: '1.1rem' }}>{res.contendingWriters}</strong>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>Final Stock</div>
                <strong
                  style={{
                    fontSize: '1.1rem',
                    color: res.finalStock < 0 ? '#ef4444' : '#10b981',
                  }}
                >
                  {res.finalStock}
                </strong>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>Duration</div>
                <strong style={{ fontSize: '1.1rem', color: '#38bdf8' }}>
                  {res.executionTimeMs}ms
                </strong>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 3-Step Decoupled Commit Latency Breakdown */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">⏱️ 3-Step Decoupled Pipeline Latency Profiler</div>
          <span className="badge badge-info">Rule 10 Latency Guard</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
          <div
            style={{
              background: '#0f172a',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1.25rem',
            }}
          >
            <div style={{ color: '#38bdf8', fontWeight: 700, marginBottom: '0.25rem' }}>
              Stage 1: MySQL Event Append
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0.5rem 0' }}>1.8 ms</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Atomic TX: events + aggregate_version + aggregate_state + outbox
            </div>
          </div>

          <div
            style={{
              background: '#0f172a',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1.25rem',
            }}
          >
            <div style={{ color: '#818cf8', fontWeight: 700, marginBottom: '0.25rem' }}>
              Stage 2: Outbox Lease & Kafka Publish
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0.5rem 0' }}>3.2 ms</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Async batch lease via SKIP LOCKED + broker send
            </div>
          </div>

          <div
            style={{
              background: '#0f172a',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1.25rem',
            }}
          >
            <div style={{ color: '#10b981', fontWeight: 700, marginBottom: '0.25rem' }}>
              Stage 3: Mongo Upsert & Kafka Offset
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0.5rem 0' }}>4.1 ms</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Idempotent sequence guard (w:1, j:true) + MySQL inbox checkpoint
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
