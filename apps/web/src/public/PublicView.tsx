import { useEffect, useState } from 'react';
import type { PublicCategory, PublicMatch, PublicSnapshot } from '@playtorneios/domain';

const fmtT = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtD = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const when = (iso: string) => `${fmtD.format(new Date(iso))} ${fmtT.format(new Date(iso))}`;
const score = (m: PublicMatch) => (m.score?.sets?.length ? m.score.sets.map((s) => `${s.a}x${s.b}`).join(' · ') : m.score?.points ? `${m.score.points.a} x ${m.score.points.b}` : '');

function MatchRow({ m }: { m: PublicMatch }) {
  const wa = m.winner === 'a', wb = m.winner === 'b';
  return (
    <li className="card">
      <div className="small muted">{m.label}{m.court ? ` · ${m.court}` : ''}{m.scheduledAt ? ` · ${when(m.scheduledAt)}` : ''}</div>
      <div className={wa ? 'win' : ''}>{m.a ?? 'A definir'}{wa && <span className="sr-only"> (venceu)</span>}</div>
      <div className={wb ? 'win' : ''}>{m.b ?? 'A definir'}{wb && <span className="sr-only"> (venceu)</span>}</div>
      <div className="small">
        {m.status === 'in_progress' && <strong className="t-live">● Ao vivo{m.live ? <> <span className="num">{m.live.a} x {m.live.b}</span> (pode ter alguns instantes de atraso)</> : ''}</strong>}
        {m.status === 'finished' && <span className="num">{m.walkover ? 'W.O.' : m.retired ? `Abandono ${score(m)}` : score(m)}</span>}
        {m.status === 'not_started' && <span className="muted">Aguardando</span>}
      </div>
    </li>
  );
}

function CategoryView({ c, embedded }: { c: PublicCategory; embedded?: boolean }) {
  const H2 = (embedded ? 'h3' : 'h2') as 'h2';
  const H3 = (embedded ? 'h4' : 'h3') as 'h3';
  return (
    <section className="stack" aria-labelledby={`cat-${c.id}`}>
      <H2 id={`cat-${c.id}`}>{c.name}</H2>
      {c.podium && (
        <div className="card"><H3>Pódio</H3><ol style={{ listStyle: 'none', padding: 0 }}><li>🥇 {c.podium.first}</li><li>🥈 {c.podium.second}</li>{c.podium.third.map((t) => <li key={t}>🥉 {t}</li>)}</ol></div>
      )}
      {c.groups?.map((g) => (
        <div className="scroll-x" role="region" aria-label={`Classificação do ${g.name}`} tabIndex={0} key={g.name}>
          <table><caption>{g.name}</caption><thead><tr><th scope="col">Pos.</th><th scope="col">Dupla</th><th scope="col">J</th><th scope="col">V</th></tr></thead>
            <tbody>{g.rows.map((r) => <tr key={r.pair}><td className="num">{r.position}º</td><th scope="row">{r.pair}</th><td className="num">{r.played}</td><td className="num">{r.wins}</td></tr>)}</tbody></table>
        </div>
      ))}
      {c.matches && c.matches.length > 0 && (
        <>
          <H3>Jogos</H3>
          <ul className="grid" style={{ listStyle: 'none', padding: 0 }}>{c.matches.map((m) => <MatchRow key={m.id} m={m} />)}</ul>
        </>
      )}
      {c.pairs && c.pairs.length > 0 && (<><H3>Duplas ({c.pairs.length})</H3><ul>{c.pairs.map((p) => <li key={p}>{p}</li>)}</ul></>)}
    </section>
  );
}

export function PublicView({ snapshot, embedded }: { snapshot: PublicSnapshot; embedded?: boolean }) {
  const Title = (embedded ? 'h2' : 'h1') as 'h1';
  const Main = (embedded ? 'div' : 'main') as 'main';
  const t = snapshot.tournament;
  const [sel, setSel] = useState<string>('todas');
  useEffect(() => {
    if (embedded) return; // a pré-visualização não pode alterar os tokens do app de administração
    const r = document.documentElement.style;
    r.setProperty('--amber', snapshot.theme.accentOnLight);
    r.setProperty('--on-amber', '#ffffff');
    document.title = `${t.name} — ${t.city}`;
  }, [snapshot, t.name, t.city, embedded]);
  const cats = snapshot.categories.filter((c) => sel === 'todas' || c.id === sel);
  return (
    <div style={{ maxWidth: '60rem', margin: '0 auto', padding: '1rem', ...(embedded ? ({ ['--amber']: snapshot.theme.accentOnLight, ['--on-amber']: '#ffffff' } as Record<string, string>) : {}) }}>
      <header>
        {snapshot.theme.logoDataUrl && <img src={snapshot.theme.logoDataUrl} alt={`Logotipo de ${t.organizationName}`} style={{ maxHeight: '4.5rem', maxWidth: '12rem', objectFit: 'contain' }} />}
        <p className="muted small">{t.organizationName}</p>
        <Title>{t.name}</Title>
        <p>{t.city} · {t.venue} · {fmtD.format(new Date(`${t.startDate}T12:00:00-03:00`))}{t.endDate !== t.startDate ? ` a ${fmtD.format(new Date(`${t.endDate}T12:00:00-03:00`))}` : ''}</p>
        {t.description && <p>{t.description}</p>}
        <p className="small muted">Atualizado em {when(snapshot.generatedAt)}. Esta página mostra o que foi sincronizado e pode ter alguns instantes de atraso.</p>
      </header>
      <Main id={embedded ? undefined : 'conteudo'} style={{ padding: 0 }}>
        <div className="field" style={{ margin: '1rem 0' }}>
          <label className="lbl" htmlFor={embedded ? 'pub-cat-prev' : 'pub-cat'}>Categoria</label>
          <select id={embedded ? 'pub-cat-prev' : 'pub-cat'} value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="todas">Todas</option>
            {snapshot.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="stack">{cats.map((c) => <CategoryView key={c.id} c={c} embedded={embedded} />)}</div>
      </Main>
    </div>
  );
}
