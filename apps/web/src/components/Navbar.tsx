import type { ConnectionState } from '../lib/api-client';

export interface NavbarProps {
  connection: ConnectionState;
  onRefresh: () => void;
}

export function Navbar({ connection, onRefresh }: NavbarProps) {
  return (
    <nav className="top-navbar">
      <div className="brand-section">
        <div className="brand-icon">⚡</div>
        <div>
          <div className="brand-title">CHRONOSCOPE</div>
          <div className="brand-subtitle">DETERMINISTIC DISTRIBUTED-SYSTEMS OBSERVATORY</div>
        </div>
      </div>

      <div className="top-pills">
        <div className={`status-pill ${connection.connected ? 'live' : 'waking'}`}>
          <div className="pulse-dot" />
          <span>
            {connection.connected
              ? `Cloud API Connected (${connection.latencyMs}ms)`
              : 'Render Waking Up / Offline Mode'}
          </span>
        </div>

        <div className="status-pill live">
          <span>MySQL 8.4 [Source of Truth]</span>
        </div>

        <div className="status-pill live">
          <span>MongoDB 7.0 [CQRS Read]</span>
        </div>

        <button
          onClick={onRefresh}
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
          title="Refresh cluster connectivity"
        >
          🔄 Probe
        </button>
      </div>
    </nav>
  );
}
