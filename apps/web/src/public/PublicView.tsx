import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicCategory, PublicMatch, PublicSnapshot } from '@playtorneios/domain';
import './public.css';
import {
  FOLLOW_KEY, MAX_FOLLOWED, MIN_QUERY, STATUS_TEXT, ago, announceDiff, categoryStatus, dateRange, groupRounds, hasContent, hm, knockoutRounds, liveMatches,
  matchesOfPair, matchesQuery, onAccent, pairNames, parseFollowed, plural, scoreColumns, serializeFollowed, upcoming, whenShort,
} from './logic.ts';
import type { MatchRef } from './logic.ts';

const ICON: Record<string, string> = {
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  check: 'M5 12l5 5L20 7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  off: 'M3 3l18 18M2 9a15 15 0 0 1 5-3M22 9a15 15 0 0 0-8-4M5 13a10 10 0 0 1 3-2M19 13a10 10 0 0 0-2.5-2M9 17a5 5 0 0 1 6 0M12 21h.01',
  x: 'M6 6l12 12M18 6L6 18',
};
function Icon({ name, fill }: { name: keyof typeof ICON; fill?: boolean }) {
  return <svg className={`icon${fill ? ' fill' : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICON[name]} /></svg>;
}

export interface Conn { fetchedAt: number; failing: boolean }
type Theme = 'dark' | 'light';
const enc = (id: string) => `categoria-${encodeURIComponent(id)}`;
const hashCategory = (): string | null => {
  const h = location.hash;
  if (!h.startsWith('#categoria-')) return null;
  try { return decodeURIComponent(h.slice('#categoria-'.length)); } catch { return null; }
};

// ---------------------------------------------------------------- cartão de partida

function MatchCard({ m, catName, showCat, mine, now, big }: { m: PublicMatch; catName: string; showCat?: boolean; mine?: boolean; now: number; big?: boolean }) {
  const cols = scoreColumns(m);
  const live = m.status === 'in_progress';
  const done = m.status === 'finished';
  const side = (name: string | null, who: 'a' | 'b') => {
    const win = done && m.winner === who;
    return (
      <div className={`pv-side${win ? ' win' : ''}`}>
        <span className="pv-name">
          {win && <Icon name="check" />}
          {name ?? <span className="pv-tbd">A definir</span>}
          {win && <span className="sr-only"> (venceu)</span>}
        </span>
        {cols.length > 0 && (
          <span className="pv-pts">
            {cols.map((s, i) => {
              const v = s[who], o = s[who === 'a' ? 'b' : 'a'];
              return <span key={i} className={`num pv-pt${s.current ? ' cur' : ''}${!s.current && v > o ? ' w' : ''}`}>{v}</span>;
            })}
          </span>
        )}
      </div>
    );
  };
  return (
    <li className={`pv-m${live ? ' live' : ''}${mine ? ' mine' : ''}${big ? ' big' : ''}`}>
      <div className="pv-m-head">
        <span className="pv-m-label">{m.label}</span>
        {live && <span className="pv-badge live"><span className="pv-dot" aria-hidden="true" />Ao vivo</span>}
        {done && <span className="pv-badge">{m.walkover ? 'W.O.' : m.retired ? 'Abandono' : 'Encerrado'}</span>}
        {m.status === 'not_started' && <span className="pv-badge"><Icon name="clock" />Aguardando</span>}
      </div>
      <p className="pv-m-meta">
        {mine && <strong className="pv-mine"><Icon name="star" fill />Seu jogo · </strong>}
        {[m.scheduledAt ? whenShort(m.scheduledAt, now) : null, m.court ?? null, showCat ? catName : null].filter(Boolean).join(' · ') || ' '}
      </p>
      {side(m.a, 'a')}
      {side(m.b, 'b')}
    </li>
  );
}

function MatchList({ refs, followed, now, showCat = true, big }: { refs: MatchRef[]; followed: string[]; now: number; showCat?: boolean; big?: boolean }) {
  return (
    <ul className="pv-grid">
      {refs.map(({ m, cat }) => <MatchCard key={m.id} m={m} catName={cat.name} showCat={showCat} big={big} now={now} mine={followed.some((f) => m.a === f || m.b === f)} />)}
    </ul>
  );
}

// ---------------------------------------------------------------- categoria

function CategoryView({ c, followed, now, o, idp }: { c: PublicCategory; followed: string[]; now: number; o: number; idp: string }) {
  const H2 = `h${2 + o}` as 'h2', H3 = `h${3 + o}` as 'h3';
  const st = categoryStatus(c);
  const matches = c.matches ?? [];
  const rounds = knockoutRounds(matches);
  const groups = groupRounds(matches);
  const groupLive = groups.some((g) => g.matches.some((m) => m.status === 'in_progress'));
  const wrap = (ms: PublicMatch[]) => <ul className="pv-grid">{ms.map((m) => <MatchCard key={m.id} m={m} catName={c.name} now={now} mine={followed.some((f) => m.a === f || m.b === f)} />)}</ul>;
  return (
    <section className="pv-cat" id={`${idp}${enc(c.id)}`} aria-labelledby={`${idp}h-${c.id}`}>
      <div className="pv-cat-head">
        <H2 id={`${idp}h-${c.id}`}>{c.name}</H2>
        <span className={`pv-badge${st === 'live' ? ' live' : ''}`}>{st === 'live' && <span className="pv-dot" aria-hidden="true" />}{STATUS_TEXT[st]}</span>
      </div>
      {c.podium && (
        <div className="pv-podium">
          <H3>Pódio</H3>
          <ol>
            {c.podium.first && <li><span aria-hidden="true">🥇</span> <span className="pv-pos">1º lugar</span> {c.podium.first}</li>}
            {c.podium.second && <li><span aria-hidden="true">🥈</span> <span className="pv-pos">2º lugar</span> {c.podium.second}</li>}
            {c.podium.third.map((t) => <li key={t}><span aria-hidden="true">🥉</span> <span className="pv-pos">3º lugar</span> {t}</li>)}
          </ol>
        </div>
      )}
      {rounds.length > 0 && (
        <div className="pv-block">
          <H3>Mata-mata</H3>
          {rounds.map((r) => (
            <div key={r.phase} className="pv-round">
              <p className="pv-round-t">{r.phase}</p>
              {wrap(r.matches)}
            </div>
          ))}
        </div>
      )}
      {(c.groups?.length ?? 0) > 0 && (
        <div className="pv-block">
          <H3>Classificação dos grupos</H3>
          <div className="pv-tables">
            {c.groups!.map((g) => (
              <div className="scroll-x" role="region" aria-label={`Classificação do ${g.name}`} tabIndex={0} data-scroll key={g.name}>
                <table className="pv-table">
                  <caption>{g.name}</caption>
                  <thead><tr><th scope="col" className="c-pos">Pos.</th><th scope="col">Dupla</th><th scope="col" className="c-n"><abbr title="Jogos">J</abbr></th><th scope="col" className="c-n"><abbr title="Vitórias">V</abbr></th></tr></thead>
                  <tbody>{g.rows.map((r) => <tr key={r.pair}><td className="num c-pos">{r.position}º</td><th scope="row">{r.pair}</th><td className="num c-n">{r.played}</td><td className="num c-n">{r.wins}</td></tr>)}</tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
      {groups.length > 0 && (
        <details className="pv-det" open={groupLive}>
          <summary>{`Jogos da fase de grupos (${groups.reduce((n, g) => n + g.matches.length, 0)})`}</summary>
          {groups.map((g) => <div key={g.group} className="pv-round"><p className="pv-round-t">{g.group}</p>{wrap(g.matches)}</div>)}
        </details>
      )}
      {st === 'empty' && (
        <p className="pv-empty">A chave desta categoria ainda não foi publicada. Esta página atualiza sozinha.</p>
      )}
      {(c.pairs?.length ?? 0) > 0 && (
        <details className="pv-det">
          <summary>{`Duplas inscritas (${c.pairs!.length})`}</summary>
          <ul className="pv-pairs">{c.pairs!.map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- página

function FollowButton({ name, on, onToggle }: { name: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="pv-btn" aria-pressed={on} aria-label={`Seguir ${name}`} onClick={onToggle}>
      <Icon name="star" fill={on} />{on ? 'Seguindo' : 'Seguir'}
    </button>
  );
}

function initialTheme(): Theme {
  return document.documentElement.dataset.contrast === 'light' ? 'light' : 'dark';
}

export function PublicView({ snapshot, embedded, conn }: { snapshot: PublicSnapshot; embedded?: boolean; conn?: Conn }) {
  const o = embedded ? 1 : 0;
  const Main = (embedded ? 'div' : 'main') as 'main';
  const Title = `h${1 + o}` as 'h1', H2 = `h${2 + o}` as 'h2';
  const idp = embedded ? 'pve-' : 'pv-';
  const t = snapshot.tournament;
  const slug = t.slug;

  // tema (só na página real; a pré-visualização do organizador não mexe nos tokens do app)
  const [theme, setTheme] = useState<Theme>(() => (embedded ? 'light' : initialTheme()));
  useEffect(() => {
    if (embedded) return;
    const r = document.documentElement;
    r.dataset.contrast = theme;
    const accent = theme === 'light' ? snapshot.theme.accentOnLight : snapshot.theme.accentOnDark;
    r.style.setProperty('--amber', accent);
    r.style.setProperty('--on-amber', onAccent(accent));
    document.title = `${t.name} — ${t.city}`;
  }, [snapshot.theme, theme, t.name, t.city, embedded]);
  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem('pt:contrast', next); } catch { /* sem armazenamento: vale só nesta visita */ }
  };

  // relógio para "hoje", "atualizado há"
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (embedded) return; const iv = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(iv); }, [embedded]);
  useEffect(() => { setNow(Date.now()); }, [snapshot]);

  // duplas seguidas (preferência local; nada sai do aparelho)
  const [followed, setFollowed] = useState<string[]>(() => {
    if (embedded) return [];
    try { return parseFollowed(localStorage.getItem(FOLLOW_KEY), slug); } catch { return []; }
  });
  const toggleFollow = (name: string) => {
    const next = followed.includes(name) ? followed.filter((n) => n !== name) : [...followed, name].slice(-MAX_FOLLOWED);
    setFollowed(next);
    if (embedded) return;
    try { localStorage.setItem(FOLLOW_KEY, serializeFollowed(localStorage.getItem(FOLLOW_KEY), slug, next)); } catch { /* sem armazenamento */ }
  };

  // anúncio discreto para leitor de tela: só mudanças de estado dos jogos de quem a pessoa segue
  const prev = useRef<PublicSnapshot | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (embedded) return;
    const msgs = announceDiff(prev.current, snapshot, followed);
    if (msgs.length) setSaid(msgs.join(' '));
    prev.current = snapshot;
  }, [snapshot]);

  // categoria (link compartilhável: /p/<slug>#categoria-<id>)
  const cats = snapshot.categories;
  const [selId, setSelId] = useState<string | null>(() => (embedded ? null : hashCategory()));
  useEffect(() => {
    if (embedded) return;
    const on = () => setSelId(hashCategory());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [embedded]);
  const defaultId = (cats.find((c) => categoryStatus(c) === 'live') ?? cats[0])?.id;
  const activeId = cats.some((c) => c.id === selId) ? (selId as string) : defaultId;
  const active = cats.find((c) => c.id === activeId);
  const navRef = useRef<HTMLUListElement>(null);
  const pick = (id: string) => {
    setSelId(id);
    if (!embedded) history.replaceState(null, '', `#${enc(id)}`);
    requestAnimationFrame(() => document.getElementById(`${idp}${enc(id)}`)?.scrollIntoView({ block: 'start' }));
  };
  const first = useRef(true);
  useEffect(() => {
    // link com #categoria-…: rola até a categoria assim que a página desenha (uma vez)
    if (embedded || !first.current) return;
    first.current = false;
    if (hashCategory()) requestAnimationFrame(() => document.getElementById(`${idp}${location.hash.slice(1)}`)?.scrollIntoView({ block: 'start' }));
  }, [embedded, idp]);
  useEffect(() => {
    // centraliza o chip ativo só dentro da faixa (scrollIntoView também rolaria a página inteira)
    const ul = navRef.current, li = ul?.querySelector<HTMLElement>('[aria-current="true"]')?.parentElement;
    if (ul && li) ul.scrollLeft = li.offsetLeft - (ul.clientWidth - li.offsetWidth) / 2;
  }, [activeId]);

  // busca
  const [query, setQuery] = useState('');
  const names = useMemo(() => pairNames(snapshot), [snapshot]);
  const searching = query.trim().length >= MIN_QUERY;
  const found = useMemo(() => (searching ? names.filter((n) => matchesQuery(n, query)) : []), [names, query, searching]);
  const [more, setMore] = useState(false);

  const live = useMemo(() => liveMatches(snapshot), [snapshot]);
  const next = useMemo(() => upcoming(snapshot), [snapshot]);
  const shownNext = more ? next : next.slice(0, 6);
  const champs = cats.filter((c) => c.podium?.first);
  const empty = !hasContent(snapshot);
  const pairBlock = (name: string, key: string) => {
    const refs = matchesOfPair(snapshot, name);
    const known = names.includes(name);
    return (
      <div className="pv-pair" key={key}>
        <div className="pv-pair-head">
          <p className="pv-pair-name">{name}</p>
          <FollowButton name={name} on={followed.includes(name)} onToggle={() => toggleFollow(name)} />
        </div>
        {refs.length > 0 ? <MatchList refs={refs} followed={followed} now={now} /> : (
          <p className="pv-empty">{known ? 'Ainda não há jogos desta dupla.' : 'Não achamos esta dupla na página agora (o nome pode ter mudado). Toque em Seguindo para remover.'}</p>
        )}
      </div>
    );
  };

  const stamp = new Date(snapshot.generatedAt).getTime();
  const staleMin = conn ? Math.round((now - stamp) / 60000) : 0;
  const dates = dateRange(t.startDate, t.endDate);

  return (
    <div className={`pv${embedded ? ' pv-embedded' : ''}`} style={embedded ? ({ ['--amber']: snapshot.theme.accentOnLight, ['--on-amber']: '#ffffff' } as Record<string, string>) : undefined}>
      <header className="pv-header">
        <div className="pv-top">
          <div className="pv-org">
            {snapshot.theme.logoDataUrl && <img src={snapshot.theme.logoDataUrl} alt="" width="40" height="40" />}
            <span className="muted small">{t.organizationName}</span>
          </div>
          {!embedded && (
            <button type="button" className="pv-btn" onClick={toggleTheme}>
              <Icon name={theme === 'light' ? 'moon' : 'sun'} />{theme === 'light' ? 'Tema escuro' : 'Modo sol'}
            </button>
          )}
        </div>
        <Title>{t.name}</Title>
        <p className="pv-where">{t.city} · {t.venue} · {dates}</p>
        {t.status === 'closed' && <p><span className="pv-badge">Torneio encerrado</span></p>}
        {t.status === 'draft' && <p><span className="pv-badge"><Icon name="clock" />Em preparação</span></p>}
        {t.description && <details className="pv-about"><summary>Sobre o torneio</summary><p>{t.description}</p></details>}
        {conn && <p className="pv-fresh small muted">Atualizado às <time dateTime={snapshot.generatedAt}>{hm(snapshot.generatedAt)}</time>{staleMin >= 5 ? ` (${ago(now - stamp)})` : ''} · conferido {ago(now - conn.fetchedAt)}</p>}
      </header>

      <Main id={embedded ? undefined : 'conteudo'} style={{ padding: 0 }}>
        {conn?.failing && (
          <p className="pv-banner" role="status"><Icon name="off" />Sem conexão. Mostrando dados das {hm(snapshot.generatedAt)}. Tentando de novo…</p>
        )}

        <div className="pv-find">
          <form role="search" aria-label="Buscar no torneio" onSubmit={(e) => e.preventDefault()}>
            <label className="lbl" htmlFor={`${idp}q`}>Encontrar minha dupla</label>
            <div className="pv-q">
              <Icon name="search" />
              <input id={`${idp}q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Digite seu nome ou sobrenome" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" />
            </div>
          </form>
        </div>

        {searching ? (
          <section className="pv-sec" aria-labelledby={`${idp}res`}>
            <H2 id={`${idp}res`}>Resultado da busca</H2>
            <p className="pv-count" role="status">{found.length ? `${plural(found.length, 'dupla encontrada', 'duplas encontradas')}${found.length > 8 ? '. Mostrando 8: digite mais letras para refinar' : ''}.` : `Nenhuma dupla encontrada para “${query.trim()}”. Confira a grafia ou tente só o sobrenome.`}</p>
            {found.slice(0, 8).map((n) => pairBlock(n, n))}
          </section>
        ) : (
          <>
            {followed.length > 0 && (
              <section className="pv-sec" aria-labelledby={`${idp}mine`}>
                <H2 id={`${idp}mine`}>Meus jogos</H2>
                {followed.map((n) => pairBlock(n, n))}
              </section>
            )}
            {live.length > 0 && (
              <section className="pv-sec" aria-labelledby={`${idp}live`}>
                <H2 id={`${idp}live`}><span className="pv-dot" aria-hidden="true" />Ao vivo agora</H2>
                <p className="pv-note small muted">Em destaque, os pontos do set em andamento. Pode haver alguns segundos de atraso.</p>
                <MatchList refs={live} followed={followed} now={now} big />
              </section>
            )}
            {next.length > 0 && (
              <section className="pv-sec" aria-labelledby={`${idp}next`}>
                <H2 id={`${idp}next`}>Próximos jogos</H2>
                <MatchList refs={shownNext} followed={followed} now={now} />
                {next.length > 6 && <button type="button" className="pv-btn" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Mostrar menos' : `Mostrar todos (${next.length})`}</button>}
              </section>
            )}
            {champs.length > 0 && (
              <section className="pv-sec" aria-labelledby={`${idp}champs`}>
                <H2 id={`${idp}champs`}>Campeões</H2>
                <ul className="pv-champs">{champs.map((c) => <li key={c.id}><span className="muted small">{c.name}</span><strong>{c.podium!.first}</strong></li>)}</ul>
              </section>
            )}
            {empty ? (
              <section className="pv-sec pv-empty-card" aria-labelledby={`${idp}soon`}>
                <H2 id={`${idp}soon`}>Em breve</H2>
                <p>Ainda não há chaves, horários ou resultados publicados. Esta página atualiza sozinha quando o organizador publicar.</p>
                {cats.length > 0 && <ul className="pv-pairs">{cats.map((c) => <li key={c.id}>{c.name}</li>)}</ul>}
              </section>
            ) : (
              <section className="pv-sec" aria-label="Jogos por categoria">
                {cats.length > 1 && (
                  <nav className="pv-catnav" aria-label="Categorias">
                    <ul ref={navRef} data-scroll>
                      {cats.map((c) => {
                        const on = c.id === activeId, lv = categoryStatus(c) === 'live';
                        return (
                          <li key={c.id}>
                            <a href={`#${enc(c.id)}`} aria-current={on ? 'true' : undefined} onClick={(e) => { e.preventDefault(); pick(c.id); }}>
                              {lv && <span className="pv-dot" aria-hidden="true" />}{c.name}{lv && <span className="sr-only"> (tem jogo ao vivo)</span>}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>
                )}
                {active && <CategoryView key={active.id} c={active} followed={followed} now={now} o={o} idp={idp} />}
              </section>
            )}
          </>
        )}
      </Main>
      <footer className="pv-foot small muted">
        <p>Esta página se atualiza sozinha. Os placares vêm do organizador e podem ter alguns segundos de atraso.</p>
      </footer>
      {!embedded && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{said}</p>}
    </div>
  );
}
