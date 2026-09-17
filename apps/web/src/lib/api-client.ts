export interface ReadyWriteResponse {
  status: 'ready' | 'not_ready';
  checks: Record<string, { status: 'ok' | 'fail'; latencyMs: number; error?: string }>;
}

const API_BASE = import.meta.env['VITE_API_BASE'] ?? '';

export async function fetchReadyWrite(): Promise<ReadyWriteResponse> {
  const response = await fetch(`${API_BASE}/health/ready/write`);
  return (await response.json()) as ReadyWriteResponse;
}
