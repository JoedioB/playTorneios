import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { deriveTheme } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { describeSync } from '../data/runtime.tsx';
import { go, useRoute } from '../lib/router.ts';
import { normalizeSearch } from '@playtorneios/domain';
import { pairName } from '../lib/format.ts';
import { Button, Icon, StatusBadge, ToastRegion } from './kit.tsx';
import { TournamentSwitcher } from './switcher.tsx';

const NAV: Array<{ group: string; items: Array<{ to: string; label: string; icon: string }> }> = [
  { group: 'Operação', items: [
    { to: '/', label: 'Central', icon: 'home' },
    { to: '/agenda', label: 'Agenda', icon: 'calendar' },
    { to: '/chaves', label: 'Chaves', icon: 'bracket' },
    { to: '/resultados', label: 'Resultados e classificação', icon: 'trophy' },
  ] },
  { group: 'Preparação', items: [
    { to: '/inscricoes', label: 'Inscrições e check-in', icon: 'list' },
    { to: '/duplas', label: 'Atletas e duplas', icon: 'users' },
    { to: '/categorias', label: 'Categorias e regras', icon: 'settings' },
    { to: '/quadras', label: 'Quadras', icon: 'court' },
    { to: '/torneio', label: 'Dados do torneio', icon: 'flag' },
  ] },
  { group: 'Publicação', items: [
    { to: '/publico', label: 'Página pública', icon: 'globe' },
    { to: '/relatorios', label: 'Relatórios', icon: 'download' },
    { to: '/encerramento', label: 'Encerramento', icon: 'lock' },
  ] },
  { group: 'Sistema', items: [
    { to: '/sync', label: 'Sincronização', icon: 'sync' },
    { to: '/sistema', label: 'Backup e preparação', icon: 'settings' },
  ] },
];

export function SyncChip() {
  const { sync } = useRuntime();
  const n = sync.pending + sync.rejected + sync.blocked;
  const chip = (() => {
    switch (sync.ui) {
      case 'online': return <StatusBadge icon="signal" tone="ok">Online</StatusBadge>;
      case 'offline': return <StatusBadge icon="signal-off" tone="warn" shape="dashed">Offline{n ? ` · ${n} pendente(s)` : ''}</StatusBadge>;
      case 'syncing': return <StatusBadge icon="sync" tone="info"><span>Sincronizando…</span></StatusBadge>;
      case 'pending': return <StatusBadge icon="clock" tone="warn" shape="dashed">{n} pendente(s)</StatusBadge>;
      case 'failed': return <StatusBadge icon="warn" tone="err" shape="dashed">Falha ao sincronizar</StatusBadge>;
      case 'conflict': return <StatusBadge icon="warn" tone="err" shape="double">Conflito</StatusBadge>;
    }
  })();
  return (
    <a href="#/sync" style={{ textDecoration: 'none' }}>
      {chip}
      <span className="sr-only">. {describeSync(sync)} Abrir central de sincronização.</span>
    </a>
  );
}

/** Busca global local (funciona offline). Padrão combobox com `/` e Ctrl+K (SPECS §11.3). */
function GlobalSearch() {
  const { state } = useRuntime();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hits = useMemo(() => {
    const n = normalizeSearch(q);
    if (!n) return [];
    const out: Array<{ key: string; label: string; to: string }> = [];
    for (const p of Object.values(state.pairs)) if (p.searchKey.includes(n)) out.push({ key: `p${p.id}`, label: `Dupla: ${pairName(state, p.id)}`, to: `/duplas?q=${encodeURIComponent(q)}` });
    for (const c of Object.values(state.categories)) if (normalizeSearch(c.name).includes(n)) out.push({ key: `c${c.id}`, label: `Categoria: ${c.name}`, to: `/chaves/${c.id}` });
    for (const m of Object.values(state.matches)) if (normalizeSearch(m.label).includes(n)) out.push({ key: `m${m.id}`, label: `Partida: ${m.label}`, to: `/resultados?m=${encodeURIComponent(m.id)}` });
    return out.slice(0, 8);
  }, [q, state]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);
  const choose = (i: number) => {
    const h = hits[i];
    if (!h) return;
    setOpen(false);
    setQ('');
    go(h.to);
  };
  return (
    <div className="search">
      <label className="sr-only" htmlFor={`${listId}-in`}>Buscar duplas, categorias e partidas</label>
      <input
        id={`${listId}-in`}
        ref={input}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && hits[idx] ? `${listId}-${idx}` : undefined}
        placeholder="Buscar (atalho: /)"
        value={q}
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setIdx(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(idx); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && hits.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Resultados da busca">
          {hits.map((h, i) => (
            <li key={h.key} id={`${listId}-${i}`} role="option" aria-selected={i === idx} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
              {h.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Shell(props: { children: ReactNode }) {
  const { state, announce, sync, storage, session } = useRuntime();
  const route = useRoute();
  const here = '/' + route.path.join('/');
  const [contrast, setContrast] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('pt:contrast') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.dataset.contrast = contrast;
    try { localStorage.setItem('pt:contrast', contrast); } catch { /* sem armazenamento */ }
    void (storage as { setPref?: (k: string, v: unknown) => Promise<void> }).setPref?.('contrast', contrast);
  }, [contrast, storage]);

  // Tema do organizador: aplicado sobre tokens, com correção automática de contraste (RF-18).
  useEffect(() => {
    const t = state.tournament?.theme;
    if (!t) return;
    const d = deriveTheme(t.primary, t.accent);
    const r = document.documentElement.style;
    if (contrast === 'dark') { r.setProperty('--amber', d.accentOnDark); r.setProperty('--on-amber', d.onAccent === '#000000' ? '#0a0e14' : '#ffffff'); }
    else { r.removeProperty('--amber'); r.removeProperty('--on-amber'); }
  }, [state.tournament?.theme, contrast]);

  useEffect(() => {
    const h = document.querySelector('main h1') as HTMLElement | null;
    document.title = `${h?.textContent ? h.textContent + ' · ' : ''}${state.tournament?.name ?? 'playTorneios'}`;
  }, [here, state.tournament?.name]);

  return (
    <div className="shell">
      <a className="skip" href="#conteudo" onClick={(e) => { e.preventDefault(); document.getElementById("conteudo")?.focus(); }}>Ir para o conteúdo</a>
      <header className="topbar">
        <a className="brand" href="#/">{state.tournament?.name ?? 'playTorneios'}</a>
        <GlobalSearch />
        <Button variant="primary" icon="play" onClick={() => go('/resultados?registrar=1')}>Registrar placar</Button>
        <TournamentSwitcher currentId={state.tournament?.id} />
        <SyncChip />
        <Button size="sm" icon="sun" pressed={contrast === 'light'} onClick={() => setContrast(contrast === 'light' ? 'dark' : 'light')}>
          Modo sol
        </Button>
        {session && <span className="muted small">{session.email}</span>}
      </header>
      <nav className="sidenav" aria-label="Principal">
        {NAV.map((g) => (
          <div key={g.group}>
            <h2>{g.group}</h2>
            <ul>
              {g.items.map((i) => {
                const active = i.to === '/' ? here === '/' : here === i.to || here.startsWith(i.to + '/');
                return (
                  <li key={i.to}>
                    <a href={`#${i.to}`} aria-current={active ? 'page' : undefined}><Icon name={i.icon} />{i.label}</a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <main id="conteudo" tabIndex={-1}>
        {sync.ui === 'conflict' && (
          <div className="banner" role="alert" style={{ marginBottom: '1rem' }}>
            <strong>Conflito: {sync.conflicts} item(ns) precisam da sua decisão.</strong> <a href="#/sync">Resolver agora</a>
          </div>
        )}
        {props.children}
      </main>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" id="sync-live">{announce}</div>
      <ToastRegion />
    </div>
  );
}
