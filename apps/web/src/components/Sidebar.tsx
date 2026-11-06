export type DashboardTab =
  | 'overview'
  | 'command-center'
  | 'timeline-diff'
  | 'causal-graph'
  | 'replay-lab'
  | 'chaos-lab'
  | 'concurrency-lab'
  | 'rule-auditor';

export interface SidebarProps {
  activeTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
  eventCount: number;
}

export function Sidebar({ activeTab, onSelectTab, eventCount }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-category">Cluster Control</div>
      <button
        className={`sidebar-btn ${activeTab === 'overview' ? 'active' : ''}`}
        onClick={() => onSelectTab('overview')}
      >
        <span>📊 Cluster Overview</span>
        <span className="sidebar-badge">Live</span>
      </button>

      <button
        className={`sidebar-btn ${activeTab === 'command-center' ? 'active' : ''}`}
        onClick={() => onSelectTab('command-center')}
      >
        <span>⚡ Command & Events</span>
        <span className="sidebar-badge">{eventCount}</span>
      </button>

      <div className="sidebar-category">Time & Causality</div>
      <button
        className={`sidebar-btn ${activeTab === 'timeline-diff' ? 'active' : ''}`}
        onClick={() => onSelectTab('timeline-diff')}
      >
        <span>🌿 Timeline DAG & Diff</span>
        <span className="sidebar-badge">DAG</span>
      </button>

      <button
        className={`sidebar-btn ${activeTab === 'causal-graph' ? 'active' : ''}`}
        onClick={() => onSelectTab('causal-graph')}
      >
        <span>🕸️ Causal Graph</span>
        <span className="sidebar-badge">Cycles-Safe</span>
      </button>

      <div className="sidebar-category">Deterministic Engine</div>
      <button
        className={`sidebar-btn ${activeTab === 'replay-lab' ? 'active' : ''}`}
        onClick={() => onSelectTab('replay-lab')}
      >
        <span>🔄 Deterministic Replay</span>
        <span className="sidebar-badge">SHA-256</span>
      </button>

      <div className="sidebar-category">Laboratory & Audits</div>
      <button
        className={`sidebar-btn ${activeTab === 'chaos-lab' ? 'active' : ''}`}
        onClick={() => onSelectTab('chaos-lab')}
      >
        <span>🔥 Chaos & Recovery</span>
        <span className="sidebar-badge">8 Paths</span>
      </button>

      <button
        className={`sidebar-btn ${activeTab === 'concurrency-lab' ? 'active' : ''}`}
        onClick={() => onSelectTab('concurrency-lab')}
      >
        <span>📈 Concurrency Lab</span>
        <span className="sidebar-badge">OCC</span>
      </button>

      <button
        className={`sidebar-btn ${activeTab === 'rule-auditor' ? 'active' : ''}`}
        onClick={() => onSelectTab('rule-auditor')}
      >
        <span>🛡️ Architecture Auditor</span>
        <span className="sidebar-badge">25 Rules</span>
      </button>
    </aside>
  );
}
