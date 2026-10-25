import { useMemo, useState } from 'react';
import { DomainError, categoryMatches } from '@playtorneios/domain';
import type { ImpactReport, Match, ResolvedMatch } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { pairName, scoreText } from '../lib/format.ts';
import { go, useRoute } from '../lib/router.ts';
import { Button, Dialog, Empty, Field, PageHead } from '../ui/kit.tsx';
import { ImpactDialog, MatchStatus, useResolution } from './common.tsx';

function slotText(state: ReturnType<typeof useRuntime>['state'], m: Match, side: 'a' | 'b', rm: ResolvedMatch | undefined): string {
  const r = side === 'a' ? rm?.a : rm?.b;
  if (r?.kind === 'pair') return pairName(state, r.pairId);
  if (r?.kind === 'bye') return 'Folga (bye)';
  const slot = side === 'a' ? m.slotA : m.slotB;
  if (slot.kind === 'winnerOf') return `Vencedor de ${state.matches[slot.matchId]?.label ?? '?'}`;
  if (slot.kind === 'loserOf') return `Perdedor de ${state.matches[slot.matchId]?.label ?? '?'}`;
  if (slot.kind === 'groupPosition') {
    const g = Object.values(state.brackets).flatMap((b) => b.groups ?? []).find((x) => x.id === slot.groupId);
    return `${slot.position}º do ${g?.name ?? 'grupo'}`;
  }
  return 'A definir';
}

function advancesTo(state: ReturnType<typeof useRuntime>['state'], m: Match): string | undefined {
  const next = Object.values(state.matches).find((x) => (x.slotA.kind === 'winnerOf' && x.slotA.matchId === m.id) || (x.slotB.kind === 'winnerOf' && x.slotB.matchId === m.id));
  return next ? `Vencedor avança para ${next.label}` : undefined;
}

export function ChavesScreen() {
  const { state, engine, run, toast } = useRuntime();
  const route = useRoute();
  const cats = Object.values(state.categories).sort((a, b) => a.name.localeCompare(b.name));
  const cid = route.path[1] ?? cats[0]?.id ?? '';
  const cat = state.categories[cid];
  const res = useResolution(state, cid);
  const [view, setView] = useState<'visual' | 'lista'>('visual');
  const [genOpen, setGenOpen] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [impact, setImpact] = useState<{ report: ImpactReport; seed: number } | null>(null);
  const [error, setError] = useState('');
  const matches = useMemo(() => (cid ? categoryMatches(state, cid) : []), [state, cid]);
  const knock = matches.filter((m) => m.phase === 'knockout');
  const rounds = [...new Set(knock.map((m) => m.round))].sort((a, b) => a - b);
  const bracket = state.brackets[cid];
  const approved = Object.values(state.registrations).filter((r) => r.categoryId === cid && r.status === 'approved').length;

  const generate = async (seed: number, token?: string) => {
    try {
      const r = await engine.dispatch({ type: 'bracket.generate', payload: { categoryId: cid, seed, confirmToken: token } });
      toast({ text: matches.length ? 'Chave gerada de novo.' : 'Chave gerada. O sorteio pode ser repetido com a mesma semente.', kind: 'ok' });
      for (const w of r.warnings) toast({ text: w, kind: 'info' });
      setImpact(null); setGenOpen(false);
    } catch (e) {
      if (e instanceof DomainError && e.code === 'IMPACT_CONFIRMATION_REQUIRED') { setGenOpen(false); setImpact({ report: e.details as ImpactReport, seed }); return; }
      if (e instanceof DomainError && e.code === 'IMPACT_BLOCKING') { setGenOpen(false); setImpact({ report: e.details as ImpactReport, seed }); return; }
      setError(e instanceof DomainError ? e.message : 'Não foi possível gerar a chave.');
    }
  };
  const start = () => {
    setError('');
    const seed = seedInput.trim() ? Number(seedInput) : Math.floor(Math.random() * 2 ** 32);
    if (!Number.isInteger(seed) || seed < 0) return setError('A semente do sorteio precisa ser um número inteiro positivo.');
    void generate(seed);
  };

  if (cats.length === 0) return (<><PageHead title="Chaves" /><Empty title="Crie uma categoria primeiro"><a href="#/categorias">Ir para categorias</a></Empty></>);

  const card = (m: Match) => {
    const rm = res?.matches[m.id];
    const win = rm?.winner.kind === 'pair' ? rm.winner.pairId : undefined;
    const A = rm?.a.kind === 'pair' ? rm.a.pairId : undefined;
    const B = rm?.b.kind === 'pair' ? rm.b.pairId : undefined;
    const to = advancesTo(state, m);
    return (
      <article className="mcard" key={m.id} aria-label={m.label}>
        <div className="small muted">{m.label}</div>
        <div className={`side ${win && win === A ? 'win' : ''}`}><span>{slotText(state, m, 'a', rm)}</span>{win && win === A && <span className="sr-only">(venceu)</span>}</div>
        <div className={`side ${win && win === B ? 'win' : ''}`}><span>{slotText(state, m, 'b', rm)}</span>{win && win === B && <span className="sr-only">(venceu)</span>}</div>
        <div className="meta">
          <MatchStatus m={m} kind={rm?.result?.kind} />{' '}
          {rm?.result && <span className="num">{scoreText(rm.result.sets, rm.result.points)}</span>}
          {to && <div>{to}</div>}
        </div>
      </article>
    );
  };

  return (
    <>
      <PageHead title="Chaves" sub={cat ? `${cat.name} · ${approved} dupla(s) aprovada(s)` : undefined}
        actions={<Button variant="primary" icon="bracket" disabled={approved < 2} onClick={() => { setError(''); setGenOpen(true); }}>{matches.length ? 'Refazer sorteio' : 'Gerar chave'}</Button>} />
      <div className="row">
        <Field label="Categoria">{(p) => <select {...p} value={cid} onChange={(e) => go(`/chaves/${e.target.value}`)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <div className="tabs" role="group" aria-label="Modo de exibição">
          <Button pressed={view === 'visual'} onClick={() => setView('visual')}>Visual</Button>
          <Button pressed={view === 'lista'} onClick={() => setView('lista')}>Lista</Button>
        </div>
      </div>
      {bracket && <p className="small muted">Sorteio com semente <span className="num">{bracket.seed}</span> (algoritmo {bracket.algorithm}): repetir a mesma semente com as mesmas duplas reproduz a chave. {bracket.byes > 0 ? `${bracket.byes} folga(s) (bye) para as melhores sementes.` : ''}</p>}
      {approved < 2 && <p className="banner" style={{ marginTop: '1rem' }}>Aprove pelo menos 2 duplas em <a href="#/inscricoes">Inscrições</a> para gerar a chave.</p>}
      {matches.length === 0 ? <div style={{ marginTop: '1rem' }}><Empty title="Chave ainda não gerada">Depois de gerar, as regras da categoria ficam congeladas.</Empty></div> : (
        <div className="stack" style={{ marginTop: '1rem' }}>
          {bracket?.groups?.map((g) => {
            const gs = res?.groups[g.id];
            const gm = matches.filter((m) => m.groupId === g.id);
            return (
              <section className="card stack" key={g.id}>
                <h2>{g.name}</h2>
                <div className="scroll-x" role="region" aria-label={`Classificação do ${g.name}`} tabIndex={0}>
                  <table>
                    <caption className="sr-only">Classificação do {g.name}</caption>
                    <thead><tr><th scope="col">Pos.</th><th scope="col">Dupla</th><th scope="col">J</th><th scope="col">V</th><th scope="col">Saldo de sets</th><th scope="col">Saldo de pontos</th></tr></thead>
                    <tbody>
                      {(gs?.rows ?? g.pairIds.map((pairId, i) => ({ pairId, position: i + 1, played: 0, wins: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0, tieUnresolved: false }))).map((r) => (
                        <tr key={r.pairId}>
                          <td className="num">{r.position}º{r.tieUnresolved ? ' (empate)' : ''}</td><th scope="row">{pairName(state, r.pairId)}</th>
                          <td className="num">{r.played}</td><td className="num">{r.wins}</td><td className="num">{r.setsFor - r.setsAgainst}</td><td className="num">{r.pointsFor - r.pointsAgainst}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {gs?.unresolvedTies.map((tie, i) => (
                  <div className="banner" role="alert" key={i}>
                    <p>Empate que os critérios não resolveram: {tie.map((id) => pairName(state, id)).join(', ')}.</p>
                    <Button size="sm" onClick={() => void run({ type: 'tie.resolve', payload: { tie: { id: `tie-${g.id}-${tie.slice().sort().join('-')}`.slice(0, 120), tournamentId: state.tournament!.id, categoryId: cid, groupId: g.id, orderedPairIds: tie, reason: 'Sorteio manual na ordem exibida' } } }, 'Empate decidido.')}>Decidir na ordem mostrada (sorteio)</Button>
                  </div>
                ))}
                <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>{gm.map((m) => <li key={m.id}>{card(m)}</li>)}</ul>
              </section>
            );
          })}
          {knock.length > 0 && (view === 'visual' ? (
            <section aria-label="Chave eliminatória"><h2>Mata-mata</h2>
              <div className="bracket" role="region" aria-label="Chave eliminatória, rolagem horizontal" tabIndex={0}>
                {rounds.map((r) => <div className="round" key={r}><h3>Rodada {r}</h3><div className="matches">{knock.filter((m) => m.round === r).sort((a, b) => a.indexInRound - b.indexInRound).map(card)}</div></div>)}
              </div>
            </section>
          ) : (
            <section aria-label="Chave eliminatória em lista"><h2>Mata-mata</h2>
              <ol className="stack">{rounds.map((r) => <li key={r}><h3>Rodada {r}</h3><ol className="stack" style={{ listStyle: 'none', padding: 0 }}>{knock.filter((m) => m.round === r).sort((a, b) => a.indexInRound - b.indexInRound).map((m) => <li key={m.id}>{card(m)}</li>)}</ol></li>)}</ol>
            </section>
          ))}
        </div>
      )}
      <Dialog open={genOpen} title={matches.length ? 'Refazer sorteio' : 'Gerar chave'} onClose={() => setGenOpen(false)}
        footer={<><Button onClick={() => setGenOpen(false)}>Cancelar</Button><Button variant="primary" icon="check" onClick={start}>{matches.length ? 'Ver o que muda' : 'Gerar chave'}</Button></>}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <p>{approved} dupla(s) aprovada(s). Duplas com semente definida ficam nas posições de semente; as demais são sorteadas.</p>
          <Field label="Semente do sorteio (opcional)" hint="Deixe em branco para sortear. Usar a mesma semente repete o sorteio.">{(p) => <input {...p} className="num" inputMode="numeric" value={seedInput} onChange={(e) => setSeedInput(e.target.value)} />}</Field>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </Dialog>
      <ImpactDialog report={impact?.report ?? null} title="Refazer o sorteio afeta resultados" keepLabel="Manter chave atual" confirmLabel="Refazer sorteio e invalidar" onCancel={() => setImpact(null)} onConfirm={() => impact && void generate(impact.seed, impact.report.token)} />
    </>
  );
}
