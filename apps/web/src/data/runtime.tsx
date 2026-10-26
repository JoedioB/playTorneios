import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DomainError } from '@playtorneios/domain';
import type { Command, TournamentState } from '@playtorneios/domain';
import { SyncEngine } from '@playtorneios/sync';
import type { ClientStorage, Snapshot, Transport } from '@playtorneios/sync';
import { payloadSchemas } from '@playtorneios/contracts';
import { uuid } from '../lib/format.ts';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
  undo?: () => void | Promise<void>;
}

export interface Runtime {
  engine: SyncEngine;
  storage: ClientStorage;
  transport: Transport;
  state: TournamentState;
  sync: Snapshot;
  /** Executa um comando de negócio; mostra erro de domínio em português e devolve `null` se falhar. */
  run: (cmd: Command, okMessage?: string) => Promise<{ warnings: string[] } | null>;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  announce: string;
  session: { email: string; organizationId: string } | null;
  setSession: (s: { email: string; organizationId: string } | null) => void;
  online: boolean;
}

const Ctx = createContext<Runtime | null>(null);

export function useRuntime(): Runtime {
  const r = useContext(Ctx);
  if (!r) throw new Error('RuntimeProvider ausente');
  return r;
}

export function RuntimeProvider(props: {
  storage: ClientStorage;
  transport: Transport;
  children: ReactNode;
  initialSession?: Runtime['session'];
  heartbeatMs?: number;
}) {
  const { storage, transport } = props;
  const engine = useMemo(
    () => new SyncEngine({ storage, transport, newId: uuid, now: () => new Date().toISOString() }),
    [storage, transport],
  );
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<TournamentState>(engine.state);
  const [sync, setSync] = useState<Snapshot>(engine.snapshot());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announce, setAnnounce] = useState('');
  const [session, setSession] = useState<Runtime['session']>(props.initialSession ?? null);
  const tid = useRef(0);
  const lastUi = useRef<string>('');
  const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void engine.init().then(() => {
      if (!alive) return;
      setState(engine.state);
      setSync(engine.snapshot());
      setReady(true);
    });
    const unsub = engine.subscribe(() => {
      setState(engine.state);
      const s = engine.snapshot();
      setSync(s);
      // Anúncio de estado de sincronização com debounce de 2 s (SPECS §11.3).
      if (s.ui !== lastUi.current) {
        lastUi.current = s.ui;
        clearTimeout(announceTimer.current);
        announceTimer.current = setTimeout(() => setAnnounce(describeSync(s)), 2000);
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [engine]);

  // Rede real: eventos do navegador + heartbeat em /health a cada 15 s com a aba visível.
  useEffect(() => {
    if (!ready) return;
    const beat = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void engine.heartbeat();
    };
    const onOnline = () => void engine.heartbeat();
    const onOffline = () => void engine.setNetwork(false);
    addEventListener('online', onOnline);
    addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', beat);
    const iv = setInterval(beat, props.heartbeatMs ?? 15000);
    beat();
    return () => {
      removeEventListener('online', onOnline);
      removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', beat);
      clearInterval(iv);
    };
  }, [engine, ready, props.heartbeatMs]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++tid.current;
    setToasts((x) => [...x.slice(-1), { ...t, id }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((x) => x.filter((t) => t.id !== id)), []);

  const run = useCallback<Runtime['run']>(
    async (cmd, okMessage) => {
      try {
        // Mesmo contrato do servidor: o que ele recusaria nunca entra na fila (evita lote rejeitado depois).
        const check = payloadSchemas[cmd.type].safeParse(JSON.parse(JSON.stringify(cmd.payload)));
        if (!check.success) {
          toast({ text: check.error.issues[0]?.message ?? 'Os dados informados não são válidos.', kind: 'err' });
          return null;
        }
        const r = await engine.dispatch(cmd);
        if (okMessage) toast({ text: okMessage, kind: 'ok' });
        for (const w of r.warnings) toast({ text: w, kind: 'info' });
        return { warnings: r.warnings };
      } catch (e) {
        if (e instanceof DomainError) {
          toast({ text: e.message, kind: 'err' });
          return null;
        }
        toast({ text: 'Não foi possível salvar. Tente novamente.', kind: 'err' });
        return null;
      }
    },
    [engine, toast],
  );

  const value = useMemo<Runtime>(
    () => ({ engine, storage, transport, state, sync, run, toasts, toast, dismissToast, announce, session, setSession, online: sync.network }),
    [engine, storage, transport, state, sync, run, toasts, toast, dismissToast, announce, session],
  );
  if (!ready) return <p role="status" style={{ padding: '2rem' }}>Carregando…</p>;
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function describeSync(s: Snapshot): string {
  switch (s.ui) {
    case 'online':
      return 'Tudo sincronizado.';
    case 'offline':
      return s.pending > 0 ? `Sem conexão. ${s.pending} alteração(ões) aguardando envio.` : 'Sem conexão. Você pode continuar trabalhando.';
    case 'syncing':
      return 'Sincronizando…';
    case 'pending':
      return `${s.pending + s.rejected + s.blocked} alteração(ões) pendente(s).`;
    case 'failed':
      return 'Falha ao sincronizar. Vamos tentar de novo.';
    case 'conflict':
      return `Conflito: ${s.conflicts} item(ns) precisam da sua decisão.`;
  }
}
