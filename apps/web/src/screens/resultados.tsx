import { useMemo, useState } from 'react';
import { categoryOutcome } from '@playtorneios/domain';
import type { Match } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { fmtDateTime, pairName, scoreText } from '../lib/format.ts';
import { useRoute } from '../lib/router.ts';
import { Button, Empty, Field, PageHead, StatusBadge } from '../ui/kit.tsx';
import { MatchStatus, ScoreDialog, useResolution } from './common.tsx';
import { LiveCard } from './central.tsx';

export function ResultadosScreen() {
  const { state, run } = useRuntime();
  const route = useRoute();
  const [catId, setCatId] = useState('');
  const [filter, setFilter] = useState<'todas' | 'pendentes' | 'finalizadas'>(route.query.get('registrar') ? 'pendentes' : 'todas');
  const [scoreId, setScoreId] = useState<string | null>(route.query.get('m'));
  const cats = Object.values(state.categories).sort((a, b) => a.name.localeCompare(b.name));
  const cid = catId || cats[0]?.id || '';
  const res = useResolution(state, cid);
  const outcome = useMemo(() => (cid && res ? categoryOutcome(state, cid, res) : null), [state, cid, res]);
  const all = useMemo(() => Object.values(state.matches).filter((m) => m.categoryId === cid).sort((a, b) => (a.scheduledAt ?? 'z').localeCompare(b.scheduledAt ?? 'z') || a.phase.localeCompare(b.phase) || a.round - b.round || a.indexInRound - b.indexInRound), [state.matches, cid]);
  const list = all.filter((m) => !res?.matches[m.id]?.autoBye).filter((m) => filter === 'todas' || (filter === 'finalizadas' ? m.lifecycle === 'finished' : m.lifecycle !== 'finished'));
  const live = all.filter((m) => m.lifecycle === 'in_progress');
  if (cats.length === 0) return (<><PageHead title="Resultados" /><Empty title="Nenhuma categoria ainda" /></>);

  const sides = (m: Match) => {
    const rm = res?.matches[m.id];
    const nm = (r: NonNullable<typeof rm>['a'] | undefined) => (r && r.kind === 'pair' ? pairName(state, r.pairId) : 'A definir');
    return [nm(rm?.a), nm(rm?.b), rm?.a.kind === 'pair' && rm?.b.kind === 'pair' && !rm.autoBye] as const;
  };
  return (
    <>
      <PageHead title="Resultados" />
      <div className="row">
        <Field label="Categoria">{(p) => <select {...p} value={cid} onChange={(e) => setCatId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <div className="tabs" role="group" aria-label="Filtro de partidas">
          {(['todas', 'pendentes', 'finalizadas'] as const).map((f) => <Button key={f} pressed={filter === f} onClick={() => setFilter(f)}>{f[0]!.toUpperCase() + f.slice(1)}</Button>)}
        </div>
      </div>
      {outcome?.complete && (
        <section className="card" style={{ marginTop: '1rem' }} aria-label="Pódio">
          <h2>Pódio</h2>
          <ol className="stack" style={{ listStyle: 'none', padding: 0 }}>
            <li><StatusBadge icon="trophy" tone="warn">1º</StatusBadge> {pairName(state, outcome.first)}</li>
            <li><StatusBadge icon="trophy" tone="mut">2º</StatusBadge> {pairName(state, outcome.second)}</li>
            {outcome.third.map((t) => <li key={t}><StatusBadge icon="trophy" tone="mut">3º</StatusBadge> {pairName(state, t)}</li>)}
          </ol>
        </section>
      )}
      {live.length > 0 && <div className="grid" style={{ marginTop: '1rem' }}>{live.map((m) => <LiveCard key={m.id} matchId={m.id} onFinish={setScoreId} />)}</div>}
      {list.length === 0 ? <div style={{ marginTop: '1rem' }}><Empty title="Nenhuma partida neste filtro" /></div> : (
        <div className="scroll-x" role="region" aria-label="Partidas da categoria" tabIndex={0} style={{ marginTop: '1rem' }}>
          <table>
            <caption className="sr-only">Partidas e resultados</caption>
            <thead><tr><th scope="col">Partida</th><th scope="col">Duplas</th><th scope="col">Horário</th><th scope="col">Situação</th><th scope="col">Placar</th><th scope="col">Ação</th></tr></thead>
            <tbody>
              {list.map((m) => {
                const [a, b, ready] = sides(m);
                const rm = res?.matches[m.id];
                return (
                  <tr key={m.id}>
                    <th scope="row">{m.label}</th>
                    <td>{a} <span className="muted">x</span> {b}</td>
                    <td className="num">{fmtDateTime(m.scheduledAt)}</td>
                    <td><MatchStatus m={m} kind={rm?.result?.kind} />{rm?.result?.recordedBy && <div className="muted small">Lançado por {rm.result.recordedBy} (juiz)</div>}</td>
                    <td className="num">{rm?.result ? scoreText(rm.result.sets, rm.result.points) || (rm.result.kind === 'walkover' ? 'W.O.' : '') : ''}</td>
                    <td>
                      <div className="row">
                        {ready && m.lifecycle === 'not_started' && <Button size="sm" icon="play" label={`Iniciar ${m.label}`} onClick={() => void run({ type: 'match.start', payload: { matchId: m.id } }, 'Partida iniciada.')}>Iniciar</Button>}
                        {ready && <Button size="sm" variant={m.lifecycle === 'finished' ? 'plain' : 'primary'} label={`${m.lifecycle === 'finished' ? 'Corrigir' : 'Registrar placar de'} ${m.label}`} onClick={() => setScoreId(m.id)}>{m.lifecycle === 'finished' ? 'Corrigir' : 'Registrar placar'}</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <HistoryPanel />
      <ScoreDialog matchId={scoreId} onClose={() => setScoreId(null)} />
    </>
  );
}

function HistoryPanel() {
  const { state } = useRuntime();
  const corrected = Object.entries(state.results).filter(([, revs]) => revs.length > 1 || revs.some((r) => r.invalidatedAt));
  if (corrected.length === 0) return null;
  return (
    <section className="card stack" style={{ marginTop: '1.5rem' }}>
      <h2>Histórico de correções</h2>
      <ul className="stack">
        {corrected.map(([mid, revs]) => (
          <li key={mid}>
            <strong>{state.matches[mid]?.label}</strong>
            <ol className="small">
              {revs.map((r) => (
                <li key={r.id}>Revisão {r.revision}: {scoreText(r.sets, r.points) || r.kind} {r.invalidatedAt ? '(invalidada)' : ''} {r.reason ? `— ${r.reason}` : ''}</li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}
