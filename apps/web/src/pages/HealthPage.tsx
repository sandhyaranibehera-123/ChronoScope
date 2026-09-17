import { useEffect, useState } from 'react';
import { fetchReadyWrite, type ReadyWriteResponse } from '../lib/api-client';

export function HealthPage() {
  const [health, setHealth] = useState<ReadyWriteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReadyWrite()
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>CHRONOSCOPE</h1>
      <p>Write-path readiness (MySQL + Redis)</p>
      {error && <pre>Error: {error}</pre>}
      {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
    </div>
  );
}
