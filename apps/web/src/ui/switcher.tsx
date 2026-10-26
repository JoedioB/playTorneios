import { useEffect, useState } from 'react';
import { api } from '../data/http-transport.ts';
import { useRuntime } from '../data/runtime.tsx';
import { listKnown, openTournament, startNewTournament } from '../lib/tournaments.ts';
import { Button, Dialog, StatusBadge } from './kit.tsx';

interface Item {
  id: string;
  name: string;
  local: boolean;
  remote: boolean;
}

/** Trocar de torneio. Funciona offline com os torneios que já estão neste aparelho. */
export function TournamentSwitcher(props: { currentId?: string }) {
  const { engine, sync, online, session } = useRuntime();
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<Array<{ id: string; name: string }> | null>(null);
  const [remoteErr, setRemoteErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ go: () => void; pending: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setRemote(null);
    setRemoteErr(false);
    if (!session) return;
    let alive = true;
    api.get<{ tournaments: Array<{ id: string; name: string }> }>('/api/tournaments')
      .then((r) => { if (alive) setRemote(r.tournaments); })
      .catch(() => { if (alive) setRemoteErr(true); });
    return () => { alive = false; };
  }, [open, session]);

  const items: Item[] = [];
  const seen = new Map<string, Item>();
  for (const k of listKnown()) {
    const it = { id: k.id, name: k.name, local: true, remote: false };
    seen.set(k.id, it);
    items.push(it);
  }
  for (const r of remote ?? []) {
    const have = seen.get(r.id);
    if (have) have.remote = true;
    else items.push({ id: r.id, name: r.name || r.id, local: false, remote: true });
  }

  // Antes de sair, tenta enviar o que está na fila; se sobrar, avisa (a fila fica guardada e segue quando voltar).
  const leave = async (go: () => void) => {
    setBusy(true);
    try {
      if (online && session) await Promise.race([engine.sync(), new Promise((r) => setTimeout(r, 6000))]).catch(() => undefined);
    } finally {
      setBusy(false);
    }
    const s = engine.snapshot();
    const pending = s.pending + s.rejected + s.blocked;
    if (pending > 0) setConfirm({ go, pending });
    else go();
  };

  return (
    <>
      <Button size="sm" icon="list" onClick={() => setOpen(true)}>Trocar torneio</Button>
      <Dialog open={open} title="Seus torneios" onClose={() => { setOpen(false); setConfirm(null); }}>
        {confirm ? (
          <div className="stack" role="alert">
            <p><strong>{confirm.pending} alteração(ões) deste torneio ainda não foram enviadas.</strong></p>
            <p className="muted">Elas ficam guardadas neste aparelho e são enviadas quando você voltar a este torneio com internet. Quem for abrir o torneio em outro aparelho não verá essas alterações até lá.</p>
            <div className="row">
              <Button variant="danger" onClick={confirm.go}>Trocar mesmo assim</Button>
              <Button onClick={() => setConfirm(null)}>Ficar neste torneio</Button>
            </div>
          </div>
        ) : (
          <div className="stack">
            {!session && <p className="muted">Sem sessão ativa: só aparecem os torneios que já estão neste aparelho.</p>}
            {session && remote === null && !remoteErr && <p role="status" className="muted">Buscando no servidor…</p>}
            {remoteErr && <p role="status" className="muted">Não foi possível consultar o servidor. Mostrando só os torneios deste aparelho.</p>}
            {items.length === 0 && remote !== null && <p className="muted">Nenhum outro torneio ainda.</p>}
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {items.map((it) => {
                const current = it.id === props.currentId;
                return (
                  <li key={it.id} className="row" style={{ justifyContent: 'space-between', gap: '1rem' }}>
                    <span>
                      <strong>{it.name}</strong>{' '}
                      {current && <StatusBadge icon="signal" tone="ok">Aberto agora</StatusBadge>}{' '}
                      {!it.local && <StatusBadge icon="download" tone="info" shape="dashed">Será baixado</StatusBadge>}
                    </span>
                    {!current && (
                      <Button size="sm" disabled={busy || (!it.local && !online)} onClick={() => void leave(() => openTournament(it.id))}>
                        {!it.local && !online ? 'Precisa de internet' : 'Abrir'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <hr />
            <Button variant="primary" icon="flag" disabled={busy} onClick={() => void leave(startNewTournament)}>Criar novo torneio</Button>
            {sync.network ? null : <p className="muted small">Sem conexão: criar e trabalhar offline funciona; o torneio novo é enviado depois.</p>}
          </div>
        )}
      </Dialog>
    </>
  );
}
