import { useState } from 'react';

export interface TimelineDiffPageProps {
  onBackToHealth?: () => void;
}

export function TimelineDiffPage({ onBackToHealth }: TimelineDiffPageProps) {
  const [baseTimelineId, setBaseTimelineId] = useState('00000000-0000-0000-0000-000000000001');
  const [branchTimelineId, setBranchTimelineId] = useState('branch-counterfactual');
  const [aggregateId, setAggregateId] = useState('order-demo-100');

  // Simulated / demonstration diff state
  const [diffResult, _setDiffResult] = useState<{
    commonAncestor: string;
    forkPosition: number;
    hashesMatch: boolean;
    stateA: Record<string, unknown>;
    stateB: Record<string, unknown>;
    divergenceReason: string;
    eventsA: Array<{ eventId: string; type: string; pos: number }>;
    eventsB: Array<{ eventId: string; type: string; pos: number }>;
  } | null>({
    commonAncestor: 'MAIN',
    forkPosition: 2,
    hashesMatch: false,
    stateA: {
      status: 'PAID',
      items: [{ sku: 'SKU-LAPTOP', quantity: 1, amountMinor: 50000 }],
      totalAmountMinor: 50000,
    },
    stateB: {
      status: 'CANCELLED',
      items: [{ sku: 'SKU-LAPTOP', quantity: 1, amountMinor: 50000 }],
      totalAmountMinor: 50000,
    },
    divergenceReason:
      "ScenarioInput 'ForcePaymentFailure' induced payment failure on branch, triggering backward saga compensation.",
    eventsA: [
      { eventId: 'ev-main-3', type: 'OrderPaid', pos: 3 },
      { eventId: 'ev-main-4', type: 'OrderShipped', pos: 4 },
    ],
    eventsB: [{ eventId: 'ev-branch-1', type: 'OrderCancelled', pos: 5 }],
  });

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem',
        maxWidth: '1200px',
        margin: '0 auto',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>
            🌿 Timeline DAG & Counterfactual Diff (Phase 7)
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: '#6b7280' }}>
            Zero-copy branching, deterministic historical playback, and causal state comparison.
          </p>
        </div>
        {onBackToHealth && (
          <button
            onClick={onBackToHealth}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            ← System Health
          </button>
        )}
      </header>

      {/* Control Bar */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr) auto',
          gap: '1rem',
          alignItems: 'end',
          padding: '1.25rem',
          background: '#f9fafb',
          borderRadius: '0.5rem',
          border: '1px solid #e5e7eb',
          marginBottom: '2rem',
        }}
      >
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '0.25rem',
            }}
          >
            Base Timeline (A)
          </label>
          <input
            type="text"
            value={baseTimelineId}
            onChange={(e) => setBaseTimelineId(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
            }}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '0.25rem',
            }}
          >
            Branch Timeline (B)
          </label>
          <input
            type="text"
            value={branchTimelineId}
            onChange={(e) => setBranchTimelineId(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
            }}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '0.25rem',
            }}
          >
            Aggregate ID
          </label>
          <input
            type="text"
            value={aggregateId}
            onChange={(e) => setAggregateId(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
            }}
          />
        </div>
        <button
          onClick={() => {
            // Re-trigger comparison or fetch
          }}
          style={{
            padding: '0.625rem 1.25rem',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Compare
        </button>
      </section>

      {diffResult && (
        <main>
          {/* Timeline Hierarchy metadata */}
          <div
            style={{
              display: 'flex',
              gap: '2rem',
              padding: '1rem',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '0.5rem',
              marginBottom: '1.5rem',
            }}
          >
            <div>
              <span style={{ fontSize: '0.875rem', color: '#1e40af' }}>Common Ancestor: </span>
              <strong>{diffResult.commonAncestor}</strong>
            </div>
            <div>
              <span style={{ fontSize: '0.875rem', color: '#1e40af' }}>Fork Position: </span>
              <strong>{diffResult.forkPosition}</strong>
            </div>
            <div>
              <span style={{ fontSize: '0.875rem', color: '#1e40af' }}>State Hash Status: </span>
              <strong style={{ color: diffResult.hashesMatch ? '#16a34a' : '#dc2626' }}>
                {diffResult.hashesMatch ? '✔ MATCH' : '✖ DIVERGED (Counterfactual Branch)'}
              </strong>
            </div>
          </div>

          {/* Divergence explanation alert */}
          <div
            style={{
              padding: '1rem',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '0.5rem',
              marginBottom: '1.5rem',
              color: '#92400e',
            }}
          >
            <strong>Causal Divergence Explanation: </strong>
            {diffResult.divergenceReason}
          </div>

          {/* Side by side state comparison */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1.5rem',
              marginBottom: '2rem',
            }}
          >
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}>
              <h2 style={{ fontSize: '1.125rem', marginTop: 0 }}>Base Timeline (MAIN)</h2>
              <div
                style={{
                  padding: '0.75rem',
                  background: '#f9fafb',
                  borderRadius: '0.375rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <strong>Status: </strong>
                  <span style={{ color: '#16a34a' }}>{String(diffResult.stateA['status'])}</span>
                </div>
                <div>
                  <strong>Total Amount: </strong>
                  {String(diffResult.stateA['totalAmountMinor'])} minor
                </div>
              </div>
              <h3 style={{ fontSize: '0.95rem' }}>Diverging Events on Base:</h3>
              <ul>
                {diffResult.eventsA.map((ev) => (
                  <li key={ev.eventId} style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                    <code>pos {ev.pos}</code>: <strong>{ev.type}</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}>
              <h2 style={{ fontSize: '1.125rem', marginTop: 0 }}>
                Branch Timeline (Counterfactual)
              </h2>
              <div
                style={{
                  padding: '0.75rem',
                  background: '#fef2f2',
                  borderRadius: '0.375rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <strong>Status: </strong>
                  <span style={{ color: '#dc2626' }}>{String(diffResult.stateB['status'])}</span>
                </div>
                <div>
                  <strong>Total Amount: </strong>
                  {String(diffResult.stateB['totalAmountMinor'])} minor
                </div>
              </div>
              <h3 style={{ fontSize: '0.95rem' }}>Diverging Events on Branch:</h3>
              <ul>
                {diffResult.eventsB.map((ev) => (
                  <li key={ev.eventId} style={{ fontSize: '0.875rem', margin: '0.25rem 0' }}>
                    <code>pos {ev.pos}</code>: <strong>{ev.type}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
