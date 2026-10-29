import { useEffect, useMemo, useState } from 'react';
import { describeRule } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { fmtTime, pairName } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import { ruleFor, useResolution } from './common.tsx';
import type { Match } from '@playtorneios/domain';

function Side(props: { matchId: string; side: 'a' | 'b' }) {
  const { state } = useRuntime();
  const m = state.matches[props.matchId] as Match;
  const res = useResolution(state, m.categoryId);
  const slot = res?.matches[m.id]?.[props.side];
  return <>{slot?.kind === 'pair' ? pairName(state, slot.pairId) : 'A definir'}</>;
}

/** Telão para TV ou projetor: o que está em jogo em cada quadra e os próximos chamados. Atualiza sozinho. */
export function TelaoScreen() {
  const { state } = useRuntime();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(iv); }, []);
  const courts = Object.values(state.courts).sort((a, b) => a.order - b.order);
  const byCourt = useMemo(() => courts.map((c) => {
    const all = Object.values(state.matches).filter((m) => m.courtId === c.id);
    const live = all.filter((m) => m.lifecycle === 'in_progress');
    const next = all.filter((m) => m.lifecycle === 'not_started' && m.scheduledAt).sort((x, y) => (x.scheduledAt as string).localeCompare(y.scheduledAt as string)).slice(0, 3);
    return { court: c, live, next };
  }), [state.matches, state.courts]);
  const t = state.tournament;
  return (
    <main id="conteudo" className="tv" aria-label="Telão do torneio">
      <header className="tv-head">
        <h1>{t?.name}</h1>
        <span className="num" aria-label="Hora atual">{fmtTime(now.toISOString())}</span>
        <button type="button" className="btn sm" onClick={() => go('/')}>Sair do telão</button>
      </header>
      <div className="tv-grid">
        {byCourt.map(({ court, live, next }) => (
          <section key={court.id} className="tv-court" aria-label={court.name}>
            <h2>{court.name}</h2>
            {live.length === 0 ? <p className="tv-idle">Livre</p> : live.map((m) => {
              const rule = ruleFor(state, m);
              const lv: { a: number; b: number; sets?: Array<{ a: number; b: number }> } = m.live ?? { a: 0, b: 0 };
              return (
                <article key={m.id} className="tv-live" aria-label={`Em jogo: ${m.label}`}>
                  <p className="muted">{state.categories[m.categoryId]?.name} · {m.label}{rule ? ` · ${describeRule(rule)}` : ''}</p>
                  {(['a', 'b'] as const).map((s) => (
                    <p className="tv-line" key={s}>
                      <span className="tv-name"><Side matchId={m.id} side={s} /></span>
                      {rule?.model === 'sets' && <span className="tv-sets num">{(lv.sets ?? []).map((x) => x[s]).join(' ')}</span>}
                      <span className="tv-pts num">{lv[s]}</span>
                    </p>
                  ))}
                </article>
              );
            })}
            {next.length > 0 && (
              <div className="tv-next">
                <h3>Próximos</h3>
                <ol>{next.map((m) => <li key={m.id}><span className="num">{fmtTime(m.scheduledAt)}</span> <Side matchId={m.id} side="a" /> × <Side matchId={m.id} side="b" /></li>)}</ol>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
