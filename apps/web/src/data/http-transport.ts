import type { Operation, PullResponse, PushResult, Transport } from '@playtorneios/sync';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const HEADERS = { 'content-type': 'application/json', 'x-playtorneios': '1' };

async function call<T>(method: string, url: string, body?: unknown, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: ctl.signal });
    if (!res.ok) {
      let code = 'ERROR';
      let message = `Erro ${res.status}`;
      try {
        const j = await res.json();
        code = j.error?.code ?? code;
        message = j.error?.message ?? message;
      } catch { /* corpo vazio */ }
      throw new HttpError(res.status, code, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  get: <T>(url: string) => call<T>('GET', url),
  post: <T>(url: string, body?: unknown) => call<T>('POST', url, body ?? {}),
  del: <T>(url: string) => call<T>('DELETE', url),
};

/**
 * Transporte do motor de sincronização. Erros de rede e 5xx viram exceção (o motor tenta de novo);
 * 4xx de validação não são reenviados automaticamente: viram `rejected` na fila (SPECS §7.5).
 */
export class HttpTransport implements Transport {
  onUnauthenticated?: () => void;

  async push(ops: Operation[]): Promise<PushResult[]> {
    try {
      const r = await api.post<{ results: PushResult[] }>('/api/sync/push', { operations: ops });
      return r.results;
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 401) {
          this.onUnauthenticated?.();
          throw e;
        }
        if (e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 408) {
          return ops.map((o) => ({ opId: o.opId, status: 'rejected' as const, error: { code: e.code, message: e.message } }));
        }
      }
      throw e;
    }
  }
  async health(): Promise<boolean> {
    try {
      await call('GET', '/api/health', undefined, 4000);
      return true;
    } catch {
      return false;
    }
  }
  pull(tournamentId: string, since: number): Promise<PullResponse> {
    return api.get(`/api/sync/pull?tournamentId=${encodeURIComponent(tournamentId)}&since=${since}`);
  }
  async resolveServer(conflictId: string): Promise<void> {
    await api.post(`/api/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`, { keep: 'server' });
  }
  async discardRejected(deviceId: string, entityKey: string): Promise<void> {
    await api.post('/api/sync/discard', { deviceId, entityKey });
  }
}
