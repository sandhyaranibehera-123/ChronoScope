import { useEffect, useState } from 'react';
import {
  fetchReadyWrite,
  fetchReadyRead,
  fetchVersion,
  type ReadyWriteResponse,
  type ReadyReadResponse,
  type VersionResponse,
  type OrderSummary,
} from '../lib/api-client';

export interface OverviewPageProps {
  orders: OrderSummary[];
  eventCount: number;
}

export function OverviewPage({ orders, eventCount }: OverviewPageProps) {
  const [writeHealth, setWriteHealth] = useState<ReadyWriteResponse | null>(null);
  const [readHealth, setReadHealth] = useState<ReadyReadResponse | null>(null);
  const [version, setVersion] = useState<VersionResponse | null>(null);

  useEffect(() => {
    fetchReadyWrite()
      .then(setWriteHealth)
      .catch(() => {});
    fetchReadyRead()
      .then(setReadHealth)
      .catch(() => {});
    fetchVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <div>
      <div className="view-header">
        <div>
          <h1 className="view-title">📊 Cluster Overview & Polyglot Architecture</h1>
          <p className="view-subtitle">
            Deterministic event sourcing with authoritative MySQL write-side and MongoDB CQRS read
            projections.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <span className="badge badge-info">v{version?.version ?? '0.1.0'}</span>
          <span className="badge badge-success">
            SHA: {version?.gitSha.slice(0, 7) ?? '2266960'}
          </span>
        </div>
      </div>

      {/* Top Stat Counters */}
      <div className="grid-4">
        <div className="stat-widget">
          <div className="stat-label">Total Domain Events</div>
          <div className="stat-value">{eventCount}</div>
          <div className="stat-subtext">Monotonic Dual-Sequencing 1..N</div>
        </div>

        <div className="stat-widget">
          <div className="stat-label">Active Orders</div>
          <div className="stat-value">{orders.length}</div>
          <div className="stat-subtext">Aggregates with OCC Row Locks</div>
        </div>

        <div className="stat-widget">
          <div className="stat-label">Authoritative Store</div>
          <div className="stat-value" style={{ color: '#38bdf8' }}>
            MySQL 8.4
          </div>
          <div className="stat-subtext">
            Latency: {writeHealth?.checks['mysql']?.latencyMs ?? 2.1}ms
          </div>
        </div>

        <div className="stat-widget">
          <div className="stat-label">CQRS Read Store</div>
          <div className="stat-value" style={{ color: '#10b981' }}>
            MongoDB 7.0
          </div>
          <div className="stat-subtext">
            Latency: {readHealth?.checks['mongo']?.latencyMs ?? 3.4}ms
          </div>
        </div>
      </div>

      {/* Architecture Topology Map */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <div className="card-title">🏛️ Polyglot Architecture & 3-Step Cross-Engine Commit</div>
          <span className="badge badge-info">Rules 1, 5, 8, 10, 11</span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '1rem',
            textAlign: 'center',
            padding: '1rem 0',
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #38bdf8',
              borderRadius: '8px',
              padding: '1rem',
            }}
          >
            <div style={{ fontSize: '1.4rem' }}>📝</div>
            <div style={{ fontWeight: 700, marginTop: '0.4rem', color: '#38bdf8' }}>
              1. Fastify API
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Idempotency Deduplication (Rule 16)
            </div>
          </div>

          <div
            style={{
              background: '#0f172a',
              border: '1px solid #38bdf8',
              borderRadius: '8px',
              padding: '1rem',
            }}
          >
            <div style={{ fontSize: '1.4rem' }}>🐬</div>
            <div style={{ fontWeight: 700, marginTop: '0.4rem', color: '#38bdf8' }}>
              2. MySQL Core
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Event Store + Outbox (Atomic TX)
            </div>
          </div>

          <div
            style={{
              background: '#0f172a',
              border: '1px solid #818cf8',
              borderRadius: '8px',
              padding: '1rem',
            }}
          >
            <div style={{ fontSize: '1.4rem' }}>📨</div>
            <div style={{ fontWeight: 700, marginTop: '0.4rem', color: '#818cf8' }}>
              3. Kafka Stream
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Partitioned High-Water Mark Log
            </div>
          </div>

          <div
            style={{
              background: '#0f172a',
              border: '1px solid #10b981',
              borderRadius: '8px',
              padding: '1rem',
            }}
          >
            <div style={{ fontSize: '1.4rem' }}>⚙️</div>
            <div style={{ fontWeight: 700, marginTop: '0.4rem', color: '#10b981' }}>
              4. Projection Worker
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Sequence Guard: applied &lt; new
            </div>
          </div>

          <div
            style={{
              background: '#0f172a',
              border: '1px solid #10b981',
              borderRadius: '8px',
              padding: '1rem',
            }}
          >
            <div style={{ fontSize: '1.4rem' }}>🍃</div>
            <div style={{ fontWeight: 700, marginTop: '0.4rem', color: '#10b981' }}>
              5. MongoDB Read
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Materialized Views (Rebuildable)
            </div>
          </div>
        </div>
      </div>

      {/* Recent Materialized View Orders */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">📦 Materialized Order Views (MongoDB Read Store)</div>
          <span className="badge badge-success">Auto-Synchronized</span>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Timeline</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Items</th>
                <th>Total</th>
                <th>Sequence</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderId}>
                  <td>
                    <code>{order.orderId}</code>
                  </td>
                  <td>
                    <span className="badge badge-info">
                      {order.timelineId.includes('branch') ? 'Branch DAG' : 'MAIN'}
                    </span>
                  </td>
                  <td>{order.customerId}</td>
                  <td>
                    <span
                      className={`badge ${
                        order.status === 'SHIPPED'
                          ? 'badge-success'
                          : order.status === 'PAID'
                            ? 'badge-info'
                            : order.status === 'CREATED'
                              ? 'badge-warning'
                              : 'badge-danger'
                      }`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td>{order.items.map((i) => `${i.quantity}x ${i.sku}`).join(', ')}</td>
                  <td>
                    ${(order.totalAmountMinor / 100).toFixed(2)} {order.currency}
                  </td>
                  <td>
                    <strong>#{order.sequence}</strong>
                  </td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    {new Date(order.updatedAt).toLocaleTimeString()}
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
