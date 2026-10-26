// Ponto de entrada SOMENTE de verificação: monta o app real com armazenamento em memória e um servidor
// em processo (as mesmas funções de domínio e sincronização da API), sem rede.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryClientStorage, MemoryServerStore, discardRejected, pullChanges, pushOperations, resolveConflictServer } from '@playtorneios/sync';
import type { Operation, Transport } from '@playtorneios/sync';
import '../src/ui/styles.css';
import { App } from '../src/App.tsx';
import { RuntimeProvider, useRuntime } from '../src/data/runtime.tsx';

const store = new MemoryServerStore();
const flags = { offline: false };
const transport: Transport = {
  async push(ops: Operation[]) { if (flags.offline) throw new Error('offline'); return pushOperations(store, ops, new Date().toISOString()); },
  async health() { return !flags.offline; },
  async pull(tid, since) { if (flags.offline) throw new Error('offline'); return pullChanges(store, tid, since); },
  async resolveServer(id) { await resolveConflictServer(store, id, new Date().toISOString()); },
  async discardRejected(d, k) { await discardRejected(store, d, k); },
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
window.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (flags.offline) throw new TypeError('offline');
  if (url.includes('/api/auth/me')) return json({ user: { email: 'org@teste.com', organizationId: 'org-1' } });
  if (url.includes('/api/tournaments')) return json({ tournaments: [] });
  if (url.includes('/api/health')) return json({ ok: true });
  return json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404);
}) as typeof fetch;

function Expose() {
  const rt = useRuntime();
  (window as any).__rt = rt;
  return null;
}
(window as any).__flags = flags;
(window as any).__store = store;
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <RuntimeProvider storage={new MemoryClientStorage()} transport={transport} heartbeatMs={1500}>
      <Expose />
      <App />
    </RuntimeProvider>
  </StrictMode>,
);
