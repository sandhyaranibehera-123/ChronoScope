import { useState } from 'react';
import { HealthPage } from './pages/HealthPage';
import { TimelineDiffPage } from './pages/TimelineDiffPage';
import { CausalGraphPage } from './pages/CausalGraphPage';

export function App() {
  const [currentView, setCurrentView] = useState<'health' | 'timeline-diff' | 'causal-graph'>(
    'causal-graph',
  );

  if (currentView === 'causal-graph') {
    return (
      <CausalGraphPage
        onBackToHealth={() => setCurrentView('health')}
        onOpenDiff={() => setCurrentView('timeline-diff')}
      />
    );
  }

  if (currentView === 'timeline-diff') {
    return <TimelineDiffPage onBackToHealth={() => setCurrentView('health')} />;
  }

  return (
    <div>
      <div
        style={{
          padding: '0.75rem 1.5rem',
          background: '#f3f4f6',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.5rem',
        }}
      >
        <button
          onClick={() => setCurrentView('timeline-diff')}
          style={{
            padding: '0.4rem 0.8rem',
            borderRadius: '0.375rem',
            border: '1px solid #d1d5db',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          🌿 Timeline Diff View (Phase 7)
        </button>
        <button
          onClick={() => setCurrentView('causal-graph')}
          style={{
            padding: '0.4rem 0.8rem',
            borderRadius: '0.375rem',
            border: '1px solid #d1d5db',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          🕸️ Causal Graph View (Phase 8) →
        </button>
      </div>
      <HealthPage />
    </div>
  );
}
