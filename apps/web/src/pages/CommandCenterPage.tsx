import { useState } from 'react';
import { submitOrderCommand, type EventRecord } from '../lib/api-client';

export interface CommandCenterPageProps {
  events: EventRecord[];
  onEventAppended: (evt: EventRecord) => void;
}

export function CommandCenterPage({ events, onEventAppended }: CommandCenterPageProps) {
  const [customerId, setCustomerId] = useState('cust-aurora-7');
  const [sku, setSku] = useState('SKU-QUANTUM-NODE');
  const [quantity, setQuantity] = useState(1);
  const [amountMinor, setAmountMinor] = useState(85000);
  const [commandId, setCommandId] = useState(`cmd-${Date.now().toString(36)}`);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setLastMessage(null);

    const res = await submitOrderCommand({
      commandId,
      customerId,
      sku,
      quantity,
      amountMinor,
    });

    setIsSubmitting(false);
    setLastMessage(res.message);
    if (res.success) {
      onEventAppended(res.event);
      // Generate next command ID
      setCommandId(`cmd-${Date.now().toString(36)}`);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h1 className="view-title">⚡ Command Dispatcher & Live Event Store</h1>
          <p className="view-subtitle">
            Submit transactional domain commands with strict dual-sequencing and row-locked OCC
            (Rules 5, 6, 8, 16).
          </p>
        </div>
      </div>

      <div className="grid-2">
        {/* Command Form */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">📝 Dispatch Order Command</div>
            <span className="badge badge-info">OCC Protected</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Idempotency Command ID</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="form-input"
                  value={commandId}
                  onChange={(e) => setCommandId(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCommandId(`cmd-${Date.now().toString(36)}`)}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Regen
                </button>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                Re-submit with the same ID to verify idempotency deduplication (Rule 16).
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Customer ID</label>
                <input
                  type="text"
                  className="form-input"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Product SKU</label>
                <input
                  type="text"
                  className="form-input"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Quantity</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Amount (cents USD)</label>
                <input
                  type="number"
                  className="form-input"
                  min="100"
                  step="100"
                  value={amountMinor}
                  onChange={(e) => setAmountMinor(Number(e.target.value))}
                  required
                />
              </div>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {isSubmitting
                  ? 'Appending to MySQL Event Store...'
                  : '🚀 Execute Command & Commit Event'}
              </button>
            </div>

            {lastMessage && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.65rem 1rem',
                  borderRadius: '6px',
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  fontSize: '0.8rem',
                  color: '#38bdf8',
                }}
              >
                ✔ {lastMessage}
              </div>
            )}
          </form>
        </div>

        {/* Dual-Sequencing Explainer */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">📐 Dual-Sequencing Invariant Proof</div>
            <span className="badge badge-success">Three-Way Invariant</span>
          </div>

          <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
            <p style={{ marginBottom: '0.75rem' }}>
              Chronoscope implements an immutable event store in MySQL backed by dual-sequencing:
            </p>
            <ul style={{ paddingLeft: '1.25rem', marginBottom: '1rem' }}>
              <li style={{ marginBottom: '0.4rem' }}>
                <strong style={{ color: '#38bdf8' }}>timeline_position:</strong> Strictly monotonic
                global increment across the entire timeline tree ($1, 2, 3..M$).
              </li>
              <li style={{ marginBottom: '0.4rem' }}>
                <strong style={{ color: '#10b981' }}>aggregate_sequence:</strong> Contiguous,
                gap-free sequence per aggregate ($1, 2, 3..N$).
              </li>
              <li>
                <strong style={{ color: '#f59e0b' }}>state_hash:</strong> Canonical SHA-256 hash of
                the resulting aggregate state, written in the same atomic transaction.
              </li>
            </ul>

            <div
              style={{
                background: '#0a0e17',
                padding: '0.85rem',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: '#38bdf8',
              }}
            >
              SELECT * FROM events
              <br />
              WHERE aggregate_id = ? AND aggregate_sequence = ?<br />
              FOR UPDATE; -- Row-locked OCC under innodb_autoinc_lock_mode = 2
            </div>
          </div>
        </div>
      </div>

      {/* Live Event Stream Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">📜 Immutable Event Log (MySQL Authoritative Stream)</div>
          <span className="badge badge-info">{events.length} Events Total</span>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timeline Pos</th>
                <th>Agg Seq</th>
                <th>Aggregate ID</th>
                <th>Event Type</th>
                <th>State Hash (SHA-256)</th>
                <th>Causation ID</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.eventId}>
                  <td>
                    <span className="badge badge-info">#{evt.timelinePosition}</span>
                  </td>
                  <td>
                    <span className="badge badge-success">seq {evt.aggregateSequence}</span>
                  </td>
                  <td>
                    <code>{evt.aggregateId}</code>
                  </td>
                  <td>
                    <strong style={{ color: '#f8fafc' }}>{evt.eventType}</strong>
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    <code>{evt.stateHash.slice(0, 16)}...</code>
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {evt.causationId ? <code>{evt.causationId.slice(0, 12)}...</code> : '—'}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
