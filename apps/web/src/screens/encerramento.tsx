import { useState } from 'react';
import { useRuntime } from '../data/runtime.tsx';
import { Button, Field, PageHead, StatusBadge } from '../ui/kit.tsx';

export function EncerramentoScreen() {
  const { state, run } = useRuntime();
  const t = state.tournament!;
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState('');
  const pend = Object.values(state.matches).filter((m) => m.lifecycle !== 'finished' && m.slotA.kind !== 'bye' && m.slotB.kind !== 'bye').length;
  if (t.status === 'closed') {
    return (
      <>
        <PageHead title="Encerramento" sub={<StatusBadge icon="lock" tone="info">Torneio encerrado</StatusBadge>} />
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 10) void run({ type: 'tournament.save', payload: { tournament: { id: t.id, status: 'open' }, reason: reason.trim() } }, 'Torneio reaberto.'); }}>
          <h2>Reabrir torneio</h2>
          <Field label="Justificativa" hint={`${reason.trim().length} de 10 caracteres no mínimo. Fica na auditoria.`}>{(p) => <textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} required />}</Field>
          <Button type="submit" variant="primary" disabled={reason.trim().length < 10}>Reabrir torneio</Button>
        </form>
      </>
    );
  }
  return (
    <>
      <PageHead title="Encerramento" />
      <section className="card stack">
        <p>{pend === 0 ? 'Todas as partidas têm resultado.' : <><strong className="num">{pend}</strong> partida(s) ainda sem resultado.</>}</p>
        {pend > 0 && <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Entendo que {pend} partida(s) ficarão sem resultado</label>}
        <Button variant="primary" icon="lock" disabled={pend > 0 && !ack} onClick={() => void run({ type: 'tournament.save', payload: { tournament: { id: t.id, status: 'closed' } } }, 'Torneio encerrado.')}>Encerrar torneio</Button>
      </section>
    </>
  );
}
