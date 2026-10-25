import { useMemo, useState } from 'react';
import { detectScheduleIssues, proposeSchedule } from '@playtorneios/domain';
import type { Assignment, Match } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { fmtDateTime, fmtTime, isoToLocalInput, localInputToIso, pairName } from '../lib/format.ts';
import { Button, Dialog, Empty, Field, PageHead } from '../ui/kit.tsx';
import { MatchStatus, useResolution } from './common.tsx';

const STEP_MIN = 20;

function MatchLabel({ m }: { m: Match }) {
  const { state } = useRuntime();
  const res = useResolution(state, m.categoryId);
  const rm = res?.matches[m.id];
  const n = (r: typeof rm extends undefined ? never : NonNullable<typeof rm>['a'] | undefined) => (r && r.kind === 'pair' ? pairName(state, r.pairId) : 'A definir');
  return <span>{m.label}<br /><span className="small muted">{n(rm?.a)} x {n(rm?.b)}</span></span>;
}

export function AgendaScreen() {
  const { state, run } = useRuntime();
  const [mode, setMode] = useState<'grade' | 'lista'>('grade');
  const [propOpen, setPropOpen] = useState(false);
  const [start, setStart] = useState(() => isoToLocalInput(new Date(`${state.tournament?.startDate ?? new Date().toISOString().slice(0, 10)}T09:00:00-03:00`).toISOString()));
  const [overwrite, setOverwrite] = useState(false);
  const [courtSel, setCourtSel] = useState<string[]>([]);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [mvCourt, setMvCourt] = useState('');
  const [mvAt, setMvAt] = useState('');
  const [err, setErr] = useState('');
  const courts = Object.values(state.courts).sort((a, b) => a.order - b.order);
  const issues = useMemo(() => detectScheduleIssues(state), [state]);
  const clash = new Set(issues.flatMap((i) => i.matchIds));
  const real = Object.values(state.matches).filter((m) => m.slotA.kind !== 'bye' && m.slotB.kind !== 'bye');
  const scheduled = real.filter((m) => m.scheduledAt && m.courtId).sort((a, b) => (a.scheduledAt as string).localeCompare(b.scheduledAt as string));
  const unscheduled = real.filter((m) => !m.scheduledAt && m.lifecycle !== 'finished');
  const chosenCourts = courtSel.length ? courtSel : courts.map((c) => c.id);
  const startIso = localInputToIso(start);
  const proposal: Assignment[] = useMemo(() => (propOpen && startIso ? proposeSchedule(state, { startAt: startIso, courtIds: chosenCourts, overwrite }) : []), [propOpen, startIso, state, overwrite, chosenCourts.join()]);

  const rows = useMemo(() => {
    if (scheduled.length === 0) return [] as number[];
    // Só os horários que têm partida: sem limite de linhas e sem buracos de madrugada em torneios de vários dias.
    const slots = new Set(scheduled.map((m) => Math.floor(Date.parse(m.scheduledAt as string) / (STEP_MIN * 60000)) * STEP_MIN * 60000));
    return [...slots].sort((a, b) => a - b);
  }, [scheduled]);

  const openMove = (m: Match) => { setMoveId(m.id); setMvCourt(m.courtId ?? courts[0]?.id ?? ''); setMvAt(isoToLocalInput(m.scheduledAt)); setErr(''); };
  const doMove = async () => {
    const iso = localInputToIso(mvAt);
    if (!mvCourt || !iso) return setErr('Escolha a quadra e informe data e hora válidas.');
    if (await run({ type: 'match.schedule', payload: { matchId: moveId!, courtId: mvCourt, scheduledAt: iso } }, 'Partida agendada.')) setMoveId(null);
  };

  if (courts.length === 0) return (<><PageHead title="Agenda" /><Empty title="Cadastre as quadras primeiro"><a href="#/quadras">Ir para quadras</a></Empty></>);
  return (
    <>
      <PageHead title="Agenda" sub={`${scheduled.length} agendada(s) · ${unscheduled.length} sem horário`}
        actions={<Button variant="primary" icon="calendar" disabled={real.length === 0} onClick={() => setPropOpen(true)}>Gerar proposta</Button>} />
      <div className="tabs" role="group" aria-label="Modo de exibição" style={{ marginBottom: '1rem' }}>
        <Button pressed={mode === 'grade'} onClick={() => setMode('grade')}>Grade</Button>
        <Button pressed={mode === 'lista'} onClick={() => setMode('lista')}>Lista por horário</Button>
      </div>
      {issues.length > 0 && (
        <div className="banner" role="alert" id="agenda-conflitos" style={{ marginBottom: '1rem' }}>
          <strong>{issues.length} conflito(s) na agenda:</strong>
          <ul>{issues.map((i, n) => <li key={n}>{i.message} ({i.matchIds.map((id) => state.matches[id]?.label).join(' e ')})</li>)}</ul>
        </div>
      )}
      {mode === 'grade' ? (
        scheduled.length === 0 ? <Empty title="Nada agendado">Use “Gerar proposta” ou agende partidas pela lista abaixo.</Empty> : (
          <div className="scroll-x" role="region" aria-label="Grade de horários, rolagem horizontal" tabIndex={0}>
            <table className="sched">
              <caption className="sr-only">Agenda por quadra e horário</caption>
              <thead><tr><th scope="col">Horário</th>{courts.map((c) => <th scope="col" key={c.id}>{c.name}</th>)}</tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t}>
                    <th scope="row" className="num">{fmtTime(new Date(t).toISOString())}</th>
                    {courts.map((c) => {
                      const here = scheduled.filter((m) => m.courtId === c.id && Date.parse(m.scheduledAt as string) >= t && Date.parse(m.scheduledAt as string) < t + STEP_MIN * 60000);
                      return (
                        <td className="cell" key={c.id}>
                          {here.length === 0 ? <span className="free">Livre</span> : here.map((m) => (
                            <div key={m.id} className={clash.has(m.id) ? 'clash' : ''} style={{ padding: '0.25rem' }} aria-describedby={clash.has(m.id) ? 'agenda-conflitos' : undefined}>
                              <MatchLabel m={m} />
                              <div className="row"><MatchStatus m={m} /><Button size="sm" label={`Mover ${m.label}`} onClick={() => openMove(m)}>Mover</Button></div>
                              {clash.has(m.id) && <div className="error">Conflito de horário</div>}
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <ol className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {scheduled.map((m) => (
            <li key={m.id} className={`card row ${clash.has(m.id) ? 'clash' : ''}`}>
              <time className="num" dateTime={m.scheduledAt}>{fmtDateTime(m.scheduledAt)}</time>
              <span className="grow"><MatchLabel m={m} /></span>
              <span>{state.courts[m.courtId ?? '']?.name}</span><MatchStatus m={m} />
              <Button size="sm" label={`Mover ${m.label}`} onClick={() => openMove(m)}>Mover</Button>
            </li>
          ))}
        </ol>
      )}
      {unscheduled.length > 0 && (
        <section className="stack" style={{ marginTop: '1.5rem' }}>
          <h2>Sem horário</h2>
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {unscheduled.map((m) => <li className="card row" key={m.id}><span className="grow"><MatchLabel m={m} /></span><Button size="sm" onClick={() => openMove(m)}>Agendar</Button></li>)}
          </ul>
        </section>
      )}
      <Dialog open={propOpen} title="Gerar proposta de agenda" onClose={() => setPropOpen(false)}
        footer={<><Button onClick={() => setPropOpen(false)}>Cancelar</Button><Button variant="primary" icon="check" disabled={proposal.length === 0} onClick={() => { void run({ type: 'schedule.apply', payload: { assignments: proposal } }, `${proposal.length} partida(s) agendada(s).`); setPropOpen(false); }}>Aplicar proposta</Button></>}>
        <div className="stack">
          <Field label="Início do primeiro jogo">{(p) => <input {...p} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <fieldset style={{ border: 0, padding: 0 }}><legend className="lbl" style={{ fontWeight: 600 }}>Quadras usadas</legend>
            {courts.map((c) => <label className="check" key={c.id}><input type="checkbox" checked={chosenCourts.includes(c.id)} onChange={(e) => setCourtSel(e.target.checked ? [...chosenCourts, c.id] : chosenCourts.filter((x) => x !== c.id))} />{c.name}</label>)}
          </fieldset>
          <label className="check"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />Refazer também as partidas que já têm horário</label>
          <p role="status">{proposal.length ? `Proposta: ${proposal.length} partida(s), de ${fmtDateTime(proposal[0]!.scheduledAt)} até ${fmtDateTime(proposal[proposal.length - 1]!.scheduledAt)}. Respeita descanso de ${state.tournament?.defaults.restMin} min e a ordem das fases.` : 'Nada a propor com esses parâmetros.'}</p>
        </div>
      </Dialog>
      <Dialog open={!!moveId} title="Agendar partida" onClose={() => setMoveId(null)}
        footer={<><Button onClick={() => setMoveId(null)}>Cancelar</Button>{moveId && state.matches[moveId]?.scheduledAt && <Button variant="danger" onClick={() => { void run({ type: 'match.schedule', payload: { matchId: moveId, courtId: null, scheduledAt: null } }, 'Horário removido.'); setMoveId(null); }}>Remover horário</Button>}<Button variant="primary" icon="check" onClick={() => void doMove()}>Salvar</Button></>}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void doMove(); }}>
          <p>{moveId ? state.matches[moveId]?.label : ''}</p>
          <Field label="Quadra">{(p) => <select {...p} value={mvCourt} onChange={(e) => setMvCourt(e.target.value)}>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
          <Field label="Data e hora (horário de Brasília)" error={err}>{(p) => <input {...p} type="datetime-local" value={mvAt} onChange={(e) => setMvAt(e.target.value)} />}</Field>
        </form>
      </Dialog>
    </>
  );
}
