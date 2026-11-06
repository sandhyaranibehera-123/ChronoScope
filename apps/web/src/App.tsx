import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar, type DashboardTab } from './components/Sidebar';
import { OverviewPage } from './pages/OverviewPage';
import { CommandCenterPage } from './pages/CommandCenterPage';
import { TimelineDiffPage } from './pages/TimelineDiffPage';
import { CausalGraphPage } from './pages/CausalGraphPage';
import { ReplayLabPage } from './pages/ReplayLabPage';
import { ChaosLabPage } from './pages/ChaosLabPage';
import { ConcurrencyLabPage } from './pages/ConcurrencyLabPage';
import { RuleAuditorPage } from './pages/RuleAuditorPage';
import {
  checkBackendConnection,
  fetchOrderList,
  MOCK_EVENTS,
  MOCK_ORDERS,
  type EventRecord,
  type OrderSummary,
  type ConnectionState,
} from './lib/api-client';

export function App() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [events, setEvents] = useState<EventRecord[]>(MOCK_EVENTS);
  const [orders, setOrders] = useState<OrderSummary[]>(MOCK_ORDERS);
  const [connection, setConnection] = useState<ConnectionState>({
    connected: false,
    latencyMs: 0,
    url: '',
  });

  const runProbe = () => {
    checkBackendConnection().then(setConnection);
    fetchOrderList().then(setOrders);
  };

  useEffect(() => {
    runProbe();
    // Poll connection every 15 seconds
    const timer = setInterval(runProbe, 15000);
    return () => clearInterval(timer);
  }, []);

  const handleEventAppended = (newEvent: EventRecord) => {
    setEvents((prev) => [newEvent, ...prev]);
    // Also add to orders if it's an OrderCreated
    if (newEvent.eventType === 'OrderCreated') {
      const newOrder: OrderSummary = {
        orderId: newEvent.aggregateId,
        timelineId: '00000000-0000-0000-0000-000000000001',
        status: 'CREATED',
        customerId: String(newEvent.payload['customerId'] ?? 'cust-live'),
        items: [
          {
            sku: String(newEvent.payload['sku'] ?? 'SKU-QUANTUM-NODE'),
            quantity: Number(newEvent.payload['quantity'] ?? 1),
            priceMinor: Number(newEvent.payload['amountMinor'] ?? 85000),
          },
        ],
        totalAmountMinor: Number(newEvent.payload['amountMinor'] ?? 85000),
        currency: 'USD',
        sequence: newEvent.aggregateSequence,
        lastEventId: newEvent.eventId,
        createdAt: newEvent.timestamp,
        updatedAt: newEvent.timestamp,
      };
      setOrders((prev) => [newOrder, ...prev]);
    }
  };

  return (
    <div className="app-container">
      <Navbar connection={connection} onRefresh={runProbe} />

      <div className="dashboard-body">
        <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} eventCount={events.length} />

        <main className="main-view">
          {!connection.connected && (
            <div className="banner-warning">
              <div>
                <strong>☁️ Cloud Backend Notice: </strong>
                Render Free Tier instances spin down with inactivity and take ~30-50s to wake up.
                The observatory is currently running in <strong>
                  Live Resilient Demo Mode
                </strong>{' '}
                with full interactive functionality!
              </div>
              <button
                onClick={runProbe}
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }}
              >
                Probe Live API
              </button>
            </div>
          )}

          {activeTab === 'overview' && <OverviewPage orders={orders} eventCount={events.length} />}

          {activeTab === 'command-center' && (
            <CommandCenterPage events={events} onEventAppended={handleEventAppended} />
          )}

          {activeTab === 'timeline-diff' && <TimelineDiffPage />}

          {activeTab === 'causal-graph' && <CausalGraphPage />}

          {activeTab === 'replay-lab' && <ReplayLabPage />}

          {activeTab === 'chaos-lab' && <ChaosLabPage />}

          {activeTab === 'concurrency-lab' && <ConcurrencyLabPage />}

          {activeTab === 'rule-auditor' && <RuleAuditorPage />}
        </main>
      </div>
    </div>
  );
}
