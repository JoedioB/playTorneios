import { useCallback, useEffect, useState } from 'react';
import type { ConflictRecord, DiscardedOp, OutboxItem } from '@playtorneios/sync';
import { describeSync, useRuntime } from '../data/runtime.tsx';
import { fmtDateTime } from '../lib/format.ts';
import { Button, Empty, PageHead, StatusBadge } from '../ui/kit.tsx';

export const OP_LABEL: Record<string, string> = {
  'tournament.save': 'Dados do torneio', 'court.save': 'Quadra', 'court.delete': 'Remover quadra', 'category.save': 'Categoria', 'category.delete': 'Remover categoria',
  'athlete.save': 'Atleta', 'athlete.anonymize': 'Anonimizar atleta', 'pair.save': 'Dupla', 'registration.create': 'Nova inscrição', 'registration.setStatus': 'Situação da inscrição',
  'registration.checkIn': 'Check-in', 'registration.setSeed': 'Semente', 'bracket.generate': 'Gerar chave', 'match.schedule': 'Horário de partida', 'schedule.apply': 'Proposta de agenda',
  'match.start': 'Iniciar partida', 'match.live_score': 'Placar ao vivo', 'result.record': 'Resultado', 'tie.resolve': 'Desempate',
};

function pick(payload: unknown): Record<string, unknown> {
  const p = payload as Record<string, unknown>;
  const inner = Object.values(p).find((v) => v && typeof v === 'object' && !Array.isArray(v)) as Record<string, unknown> | undefined;
  return inner ?? p;
}

function Values({ title, when, data, keys }: { title: string; when?: string; data: Record<string, unknown> | undefined; keys: string[] }) {
  return (
    <section className="card" aria-label={title}>
      <h3>{title}</h3>
      {when && <p className="small muted">{when}</p>}
      <dl className="small">
        {keys.map((k) => (<div key={k}><dt className="muted">{k}</dt><dd style={{ margin: '0 0 0.5rem' }} className="mono">{typeof data?.[k] === 'object' ? JSON.stringify(data?.[k]) : String(data?.[k] ?? '—')}</dd></div>))}
      </dl>
    </section>
  );
}

export function SyncScreen() {
  const { engine, sync, state, toast, transport } = useRuntime();
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [discarded, setDiscarded] = useState<DiscardedOp[]>([]);
  const [busy, setBusy] = useState(false);
  const tid = state.tournament?.id;

  const load = useCallback(async () => {
    setDiscarded(await engine.opt.storage.listDiscarded());
    if (!tid) return;
    try {
      const r = await transport.pull(tid, -1);
      setConflicts(r.openConflicts ?? []);
    } catch { /* offline: mostra só o que há localmente */ }
  }, [engine, tid, transport]);
  useEffect(() => { void load(); }, [load, sync.conflicts, sync.pending]);

  const now = async () => {
    setBusy(true);
    try {
      const ok = await engine.heartbeat();
      if (ok) { await engine.sync(); await load(); toast({ text: 'Sincronização concluída.', kind: 'ok' }); }
      else toast({ text: 'Sem conexão com o servidor. Suas alterações continuam salvas aqui.', kind: 'info' });
    } finally { setBusy(false); }
  };
  const items = engine.outbox;
  const statusBadge = (i: OutboxItem) => {
    switch (i.status) {
      case 'rejected': return <StatusBadge icon="x" tone="err" shape="dashed">Rejeitada</StatusBadge>;
      case 'conflict': return <StatusBadge icon="warn" tone="err" shape="double">Conflito</StatusBadge>;
      case 'blocked': return <StatusBadge icon="lock" tone="warn" shape="dashed">Bloqueada</StatusBadge>;
      case 'inflight': return <StatusBadge icon="sync" tone="info">Enviando</StatusBadge>;
      default: return <StatusBadge icon="clock" tone="warn" shape="dashed">Pendente</StatusBadge>;
    }
  };
  return (
    <>
      <PageHead title="Sincronização" sub={describeSync(sync)} actions={<Button variant="primary" icon="sync" disabled={busy} onClick={() => void now()}>Sincronizar agora</Button>} />
      <div className="grid">
        <div className="card"><div className="num" style={{ fontSize: '2rem' }}>{sync.pending}</div>pendentes</div>
        <div className="card"><div className="num" style={{ fontSize: '2rem' }}>{sync.rejected}</div>rejeitadas</div>
        <div className="card"><div className="num" style={{ fontSize: '2rem' }}>{sync.conflicts}</div>conflitos</div>
      </div>
      {sync.nextRetryInMs !== undefined && sync.ui !== 'online' && <p className="muted">Próxima tentativa automática em cerca de {Math.ceil(sync.nextRetryInMs / 1000)} s. {sync.lastError}</p>}

      {engine.conflictItems().length > 0 && (
        <section className="stack" style={{ marginTop: '1.5rem' }} aria-label="Conflitos">
          <h2 role="alert">Conflito: {engine.conflictItems().length} item(ns) precisam da sua decisão.</h2>
          {engine.conflictItems().map((it) => {
            const c = conflicts.find((x) => x.id === it.conflictId);
            const mine = pick(it.op.payload);
            const keys = Object.keys(mine).filter((k) => k !== 'id');
            return (
              <div className="card stack" key={it.op.opId}>
                <p><strong>{OP_LABEL[it.op.type] ?? it.op.type}</strong> — as duas versões ficam guardadas. Escolha a que vale.</p>
                <div className="versus">
                  <Values title="Este aparelho" when={`salvo às ${fmtDateTime(it.op.clientCreatedAt)}`} data={mine} keys={keys} />
                  <Values title="Servidor" when={c ? `versão ${c.serverVersion}` : 'conecte-se para ver o valor do servidor'} data={c?.serverValue as Record<string, unknown> | undefined} keys={keys} />
                </div>
                <div className="row">
                  <Button variant="primary" disabled={!c} onClick={() => c && void engine.resolveConflict(c, 'device').then(load)}>Manter este aparelho</Button>
                  <Button disabled={!c} onClick={() => c && void engine.resolveConflict(c, 'server').then(load)}>Manter o servidor</Button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="stack" style={{ marginTop: '1.5rem' }}>
        <h2>Fila de envio</h2>
        {items.length === 0 ? <Empty title="Tudo enviado">Não há alterações aguardando o servidor.</Empty> : (
          <div className="scroll-x" role="region" aria-label="Fila de envio" tabIndex={0}>
            <table>
              <caption className="sr-only">Operações aguardando envio</caption>
              <thead><tr><th scope="col">Quando</th><th scope="col">O quê</th><th scope="col">Situação</th><th scope="col">Detalhe</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.op.opId}>
                    <td className="num small">{fmtDateTime(i.op.clientCreatedAt)}</td>
                    <td>{OP_LABEL[i.op.type] ?? i.op.type}</td>
                    <td>{statusBadge(i)}</td>
                    <td>
                      {i.error && <p className="error">{i.error.message}</p>}
                      {i.status === 'rejected' && <Button size="sm" variant="danger" onClick={() => void engine.discardRejected(i.op.opId).then(load)}>Descartar</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {discarded.length > 0 && (
        <section className="stack" style={{ marginTop: '1.5rem' }}>
          <h2>Descartadas (recuperáveis)</h2>
          <ul>{discarded.map((d, n) => <li key={n} className="small">{fmtDateTime(d.at)} — {OP_LABEL[d.op.type] ?? d.op.type} ({d.reason === 'server_kept' ? 'servidor prevaleceu' : 'descartada por você'})</li>)}</ul>
        </section>
      )}
    </>
  );
}
