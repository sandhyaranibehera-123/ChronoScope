import { useState } from 'react';

export interface CausalGraphPageProps {
  onBackToHealth?: () => void;
  onOpenDiff?: () => void;
}

export function CausalGraphPage({ onBackToHealth, onOpenDiff }: CausalGraphPageProps) {
  const [selectedMode, setSelectedMode] = useState<'trace' | 'workflow' | 'explain'>('workflow');
  const [targetId, setTargetId] = useState('workflow-order-fulfillment-100');
  const [formatView, setFormatView] = useState<'visual' | 'ascii' | 'dot' | 'mermaid'>('visual');

  // Interactive sample state representing a complete multi-aggregate saga
  const sampleNodes = [
    {
      id: 'ev-order-1',
      type: 'OrderCreated',
      aggregate: 'Order:order-100',
      pos: 1,
      seq: 1,
      causationId: null,
      summary: 'customerId:cust-1, currency:INR',
    },
    {
      id: 'ev-order-2',
      type: 'OrderConfirmed',
      aggregate: 'Order:order-100',
      pos: 2,
      seq: 2,
      causationId: 'ev-order-1',
      summary: 'items:1, amountMinor:50000',
    },
    {
      id: 'ev-pay-1',
      type: 'PaymentAuthorized',
      aggregate: 'Payment:pay-100',
      pos: 3,
      seq: 1,
      causationId: 'ev-order-2',
      summary: 'amount:50000, method:CARD',
    },
    {
      id: 'ev-pay-2',
      type: 'PaymentFailed',
      aggregate: 'Payment:pay-100',
      pos: 4,
      seq: 2,
      causationId: 'ev-pay-1',
      summary: 'reason:ForcePaymentFailure (Simulation)',
    },
    {
      id: 'ev-order-3',
      type: 'OrderCancelled',
      aggregate: 'Order:order-100',
      pos: 5,
      seq: 3,
      causationId: 'ev-pay-2',
      summary: 'compensationReason:PaymentFailure',
    },
  ];

  const _sampleEdges = [
    { source: 'ev-order-1', target: 'ev-order-2', type: 'CAUSATION' },
    { source: 'ev-order-2', target: 'ev-pay-1', type: 'CAUSATION' },
    { source: 'ev-pay-1', target: 'ev-pay-2', type: 'CAUSATION' },
    { source: 'ev-pay-2', target: 'ev-order-3', type: 'CAUSATION' },
    { source: 'ev-order-2', target: 'ev-pay-1', type: 'WORKFLOW' },
    { source: 'ev-pay-2', target: 'ev-order-3', type: 'WORKFLOW' },
  ];

  const sampleExplanation = {
    target: 'OrderCancelled (ev-order-3)',
    immediateCause: 'PaymentFailed (ev-pay-2)',
    rootEvent: 'OrderCreated (ev-order-1)',
    narrative:
      "Event 'OrderCancelled' (Order:order-100) was directly caused by 'PaymentFailed' (ev-pay-2) via backward saga compensation, originating from root event 'OrderCreated' (ev-order-1) in timeline 'MAIN'.",
  };

  const aggregateColors: Record<string, { bg: string; border: string; badge: string }> = {
    Order: { bg: '#eff6ff', border: '#bfdbfe', badge: '#1d4ed8' },
    Payment: { bg: '#fffbeb', border: '#fde68a', badge: '#b45309' },
    Inventory: { bg: '#f0fdf4', border: '#bbf7d0', badge: '#15803d' },
    Shipment: { bg: '#faf5ff', border: '#e9d5ff', badge: '#7e22ce' },
  };

  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '2rem',
        maxWidth: '1280px',
        margin: '0 auto',
        color: '#1f2937',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '2rem',
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.875rem', fontWeight: 700, color: '#111827' }}>
            🕸️ Causal Graph & Cycle-Safe Traversal (Phase 8)
          </h1>
          <p style={{ margin: '0.5rem 0 0', color: '#4b5563', fontSize: '0.95rem' }}>
            Rule 5 (causation_id → event_id), Rule 12 (MySQL-only event DAG), Rule 24 (Cycle-safety
            guard)
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {onOpenDiff && (
            <button
              onClick={onOpenDiff}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                background: '#fff',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              🌿 Open Diff View
            </button>
          )}
          {onBackToHealth && (
            <button
              onClick={onBackToHealth}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                background: '#fff',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              ← System Health
            </button>
          )}
        </div>
      </header>

      {/* Control Bar */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          background: '#f9fafb',
          padding: '1rem',
          borderRadius: '0.5rem',
          border: '1px solid #e5e7eb',
          marginBottom: '2rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(['workflow', 'trace', 'explain'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setSelectedMode(m);
                if (m === 'workflow') setTargetId('workflow-order-fulfillment-100');
                else if (m === 'trace') setTargetId('ev-order-3');
                else if (m === 'explain') setTargetId('ev-order-3');
              }}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '0.25rem',
                border: selectedMode === m ? '1px solid #2563eb' : '1px solid #d1d5db',
                background: selectedMode === m ? '#2563eb' : '#fff',
                color: selectedMode === m ? '#fff' : '#374151',
                cursor: 'pointer',
                fontWeight: 500,
                textTransform: 'capitalize',
              }}
            >
              {m === 'workflow'
                ? 'Multi-Aggregate DAG'
                : m === 'trace'
                  ? 'Event Trace'
                  : 'Root-Cause Explain'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
            Target ID:
          </label>
          <input
            type="text"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '0.25rem',
              border: '1px solid #d1d5db',
              fontSize: '0.875rem',
              width: '100%',
              maxWidth: '340px',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(['visual', 'ascii', 'dot', 'mermaid'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => setFormatView(fmt)}
              style={{
                padding: '0.35rem 0.65rem',
                borderRadius: '0.25rem',
                border: formatView === fmt ? '1px solid #4b5563' : '1px solid #d1d5db',
                background: formatView === fmt ? '#374151' : '#fff',
                color: formatView === fmt ? '#fff' : '#4b5563',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 500,
                textTransform: 'uppercase',
              }}
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {/* Cycle Guard & Metrics Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            padding: '1rem',
            borderRadius: '0.5rem',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 600 }}>
            RULE 24 CYCLE GUARD
          </div>
          <div
            style={{ fontSize: '1.25rem', fontWeight: 700, color: '#15803d', marginTop: '0.25rem' }}
          >
            🛡️ Safe (0 Cycles)
          </div>
          <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '0.25rem' }}>
            Cycle-safe recursion active
          </div>
        </div>

        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            padding: '1rem',
            borderRadius: '0.5rem',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#1e40af', fontWeight: 600 }}>
            TOTAL NODES & EDGES
          </div>
          <div
            style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1d4ed8', marginTop: '0.25rem' }}
          >
            5 Nodes · 6 Edges
          </div>
          <div style={{ fontSize: '0.75rem', color: '#1e40af', marginTop: '0.25rem' }}>
            Branching factor: 1.20
          </div>
        </div>

        <div
          style={{
            background: '#faf5ff',
            border: '1px solid #e9d5ff',
            padding: '1rem',
            borderRadius: '0.5rem',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#6b21a8', fontWeight: 600 }}>TYPED EDGES</div>
          <div
            style={{ fontSize: '1.25rem', fontWeight: 700, color: '#7e22ce', marginTop: '0.25rem' }}
          >
            4 Causation · 2 Workflow
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b21a8', marginTop: '0.25rem' }}>
            Cross-aggregate saga link
          </div>
        </div>

        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            padding: '1rem',
            borderRadius: '0.5rem',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 600 }}>
            MAX CAUSAL DEPTH
          </div>
          <div
            style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b45309', marginTop: '0.25rem' }}
          >
            Depth 4 Steps
          </div>
          <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: '0.25rem' }}>
            Genesis to compensation
          </div>
        </div>
      </div>

      {/* Root Cause Narrative Box (if explain mode active or visible) */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
          padding: '1.25rem',
          marginBottom: '2rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem', color: '#111827' }}>
          📋 Automated Root-Cause Diagnosis:
        </h2>
        <p style={{ margin: 0, color: '#374151', fontSize: '0.95rem', lineHeight: 1.5 }}>
          {sampleExplanation.narrative}
        </p>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '0.2rem 0.5rem',
              borderRadius: '0.25rem',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            Target: {sampleExplanation.target}
          </span>
          <span
            style={{
              background: '#fef3c7',
              color: '#92400e',
              padding: '0.2rem 0.5rem',
              borderRadius: '0.25rem',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            Immediate Cause: {sampleExplanation.immediateCause}
          </span>
          <span
            style={{
              background: '#dbeafe',
              color: '#1e40af',
              padding: '0.2rem 0.5rem',
              borderRadius: '0.25rem',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            Origin: {sampleExplanation.rootEvent}
          </span>
        </div>
      </div>

      {/* Main View Area */}
      {formatView === 'visual' ? (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.5rem',
            }}
          >
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>
              Causal DAG Nodes & Lineage Chains
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    background: '#2563eb',
                    borderRadius: '2px',
                  }}
                />{' '}
                CausationEdge
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    background: '#059669',
                    borderRadius: '2px',
                  }}
                />{' '}
                WorkflowEdge
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    background: '#7c3aed',
                    borderRadius: '2px',
                  }}
                />{' '}
                TimelineAncestryEdge
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {sampleNodes.map((node, index) => {
              const aggType = node.aggregate.split(':')[0] || 'Order';
              const theme = aggregateColors[aggType] || aggregateColors['Order']!;

              return (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                  }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: '#374151',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </div>

                  <div
                    style={{
                      flex: 1,
                      background: theme.bg,
                      border: `1px solid ${theme.border}`,
                      borderRadius: '0.5rem',
                      padding: '1rem',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>
                          {node.type}
                        </span>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.15rem 0.4rem',
                            borderRadius: '0.25rem',
                            background: '#fff',
                            border: `1px solid ${theme.border}`,
                            color: theme.badge,
                            fontWeight: 600,
                          }}
                        >
                          {node.aggregate}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                        pos: {node.pos} · seq: {node.seq}
                      </div>
                    </div>

                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#4b5563' }}>
                      Payload:{' '}
                      <code
                        style={{
                          background: '#fff',
                          padding: '0.1rem 0.3rem',
                          borderRadius: '0.2rem',
                        }}
                      >
                        {node.summary}
                      </code>
                    </div>

                    <div
                      style={{
                        marginTop: '0.5rem',
                        fontSize: '0.75rem',
                        color: '#6b7280',
                        display: 'flex',
                        gap: '1rem',
                      }}
                    >
                      <span>
                        event_id: <code>{node.id}</code>
                      </span>
                      <span>
                        causation_id: <code>{node.causationId ?? 'NULL (ROOT)'}</code>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: '#1f2937',
            color: '#f9fafb',
            borderRadius: '0.5rem',
            padding: '1.25rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {formatView === 'ascii' &&
            `Causal Graph: 5 nodes, 6 edges (4 causation, 2 workflow, 0 ancestry)
────────────────────────────────────────────────────────────────────────────────
└── OrderCreated (Order:order-100) pos:1 seq:1 [customerId:cust-1]
    └── ──(CAUSATION)──> OrderConfirmed (Order:order-100) pos:2 seq:2 [items:1]
        ├── ──(CAUSATION)──> PaymentAuthorized (Payment:pay-100) pos:3 seq:1 [amount:50000]
        │   └── ──(CAUSATION)──> PaymentFailed (Payment:pay-100) pos:4 seq:2 [reason:Simulation]
        │       └── ──(CAUSATION)──> OrderCancelled (Order:order-100) pos:5 seq:3 [compensationReason:PaymentFailure]
        └── ──(WORKFLOW)──> PaymentAuthorized (Payment:pay-100) pos:3 seq:1`}

          {formatView === 'dot' &&
            `digraph ChronoscopeCausalGraph {
  rankdir=LR;
  node [shape=box, style="rounded,filled", fontname="Helvetica"];
  edge [fontname="Helvetica", fontsize=10];

  "ev-order-1" [label="OrderCreated\\nOrder:order-100", fillcolor="#dbeafe"];
  "ev-order-2" [label="OrderConfirmed\\nOrder:order-100", fillcolor="#dbeafe"];
  "ev-pay-1" [label="PaymentAuthorized\\nPayment:pay-100", fillcolor="#fef3c7"];
  "ev-pay-2" [label="PaymentFailed\\nPayment:pay-100", fillcolor="#fef3c7"];
  "ev-order-3" [label="OrderCancelled\\nOrder:order-100", fillcolor="#dbeafe"];

  "ev-order-1" -> "ev-order-2" [color="#2563eb", style="bold", label="causation"];
  "ev-order-2" -> "ev-pay-1" [color="#2563eb", style="bold", label="causation"];
  "ev-pay-1" -> "ev-pay-2" [color="#2563eb", style="bold", label="causation"];
  "ev-pay-2" -> "ev-order-3" [color="#2563eb", style="bold", label="causation"];
  "ev-order-2" -> "ev-pay-1" [color="#059669", style="dotted", label="workflow"];
  "ev-pay-2" -> "ev-order-3" [color="#059669", style="dotted", label="workflow"];
}`}

          {formatView === 'mermaid' &&
            `flowchart LR
  ev_order_1["OrderCreated<br/>Order:order-100"]
  ev_order_2["OrderConfirmed<br/>Order:order-100"]
  ev_pay_1["PaymentAuthorized<br/>Payment:pay-100"]
  ev_pay_2["PaymentFailed<br/>Payment:pay-100"]
  ev_order_3["OrderCancelled<br/>Order:order-100"]

  ev_order_1 ==>|causation| ev_order_2
  ev_order_2 ==>|causation| ev_pay_1
  ev_pay_1 ==>|causation| ev_pay_2
  ev_pay_2 ==>|causation| ev_order_3
  ev_order_2 -->|workflow| ev_pay_1
  ev_pay_2 -->|workflow| ev_order_3`}
        </div>
      )}
    </div>
  );
}
