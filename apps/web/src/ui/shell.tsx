import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { deriveTheme, detectScheduleIssues } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { describeSync } from '../data/runtime.tsx';
import { go, useRoute } from '../lib/router.ts';
import { normalizeSearch } from '@playtorneios/domain';
import { pairName } from '../lib/format.ts';
import { Button, Dialog, Icon, StatusBadge, ToastRegion } from './kit.tsx';
import { signOut } from '../lib/session.ts';
import { TournamentSwitcher } from './switcher.tsx';

type NavItem = { to: string; label: string; icon: string };
/** Ordem = ciclo de vida do torneio: preparar, inscrever, chaves e agenda, evento, depois. */
const NAV: Array<{ group: string | null; items: NavItem[] }> = [
  { group: null, items: [
    { to: '/', label: 'Central', icon: 'home' },
  ] },
  { group: 'Preparar', items: [
    { to: '/torneio', label: 'Dados do torneio', icon: 'flag' },
    { to: '/quadras', label: 'Quadras', icon: 'court' },
    { to: '/categorias', label: 'Categorias e regras', icon: 'list' },
  ] },
  { group: 'Inscrições', items: [
    { to: '/duplas', label: 'Atletas e duplas', icon: 'users' },
    { to: '/inscricoes', label: 'Inscrições e check-in', icon: 'check-circle' },
  ] },
  { group: 'Chaves e agenda', items: [
    { to: '/chaves', label: 'Chaves', icon: 'bracket' },
    { to: '/agenda', label: 'Agenda', icon: 'calendar' },
  ] },
  { group: 'Dia do evento', items: [
    { to: '/resultados', label: 'Resultados', icon: 'trophy' },
    { to: '/juizes', label: 'Links dos juízes', icon: 'play' },
    { to: '/telao', label: 'Telão', icon: 'signal' },
    { to: '/imprimir', label: 'Imprimir súmulas', icon: 'copy' },
  ] },
  { group: 'Depois do evento', items: [
    { to: '/publico', label: 'Página pública', icon: 'globe' },
    { to: '/relatorios', label: 'Relatórios', icon: 'download' },
    { to: '/encerramento', label: 'Encerramento', icon: 'lock' },
  ] },
  { group: 'Sistema', items: [
    { to: '/sync', label: 'Sincronização', icon: 'sync' },
    { to: '/sistema', label: 'Backup e segurança', icon: 'settings' },
  ] },
];

/**
 * Avisos curtos sob o item do menu: dizem o que falta antes de usar a tela (ou o que está pendente),
 * sem esconder nem desabilitar o item. Entram no nome acessível do link.
 */
function useNavNotes(): Record<string, { text: string; warn?: boolean }> {
  const { state } = useRuntime();
  return useMemo(() => {
    const regs = Object.values(state.registrations);
    const cats = Object.keys(state.categories).length;
    const courts = Object.keys(state.courts).length;
    const matches = Object.keys(state.matches).length;
    const pending = regs.filter((r) => r.status === 'pending').length;
    const ready = Object.keys(state.categories).some((id) => regs.filter((r) => r.categoryId === id && r.status === 'approved').length >= 2);
    const conflicts = matches ? detectScheduleIssues(state).length : 0;
    const n: Record<string, { text: string; warn?: boolean }> = {};
    if (!cats) n['/inscricoes'] = { text: 'Crie categorias antes' };
    else if (pending) n['/inscricoes'] = { text: `${pending} a aprovar`, warn: true };
    if (!cats) n['/chaves'] = { text: 'Crie categorias antes' };
    else if (!ready) n['/chaves'] = { text: 'Aprove 2 duplas' };
    if (!courts) n['/agenda'] = { text: 'Cadastre quadras antes' };
    else if (!matches) n['/agenda'] = { text: 'Gere as chaves antes' };
    else if (conflicts) n['/agenda'] = { text: `${conflicts} conflito(s)`, warn: true };
    if (!matches) { n['/resultados'] = { text: 'Gere as chaves antes' }; n['/imprimir'] = { text: 'Gere as chaves antes' }; }
    if (!courts) { n['/juizes'] = { text: 'Cadastre quadras antes' }; n['/telao'] = { text: 'Cadastre quadras antes' }; }
    return n;
  }, [state]);
}

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
  const [outOpen, setOutOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const notes = useNavNotes();
  const unsent = sync.pending + sync.rejected + sync.blocked;
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

  // Menu recolhido (telas estreitas): fecha ao trocar de rota e com Esc.
  useEffect(() => { setMenu(false); }, [here]);
  useEffect(() => {
    if (!menu) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [menu]);
  // Altura real da barra superior (ela quebra linha): usada no scroll-padding e no menu lateral fixo.
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--topbar-h', getComputedStyle(el).position === 'sticky' ? `${el.offsetHeight}px` : '0px');
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--topbar-h'); };
  }, []);

  useEffect(() => {
    const h = document.querySelector('main h1') as HTMLElement | null;
    document.title = `${h?.textContent ? h.textContent + ' · ' : ''}${state.tournament?.name ?? 'playTorneios'}`;
  }, [here, state.tournament?.name]);

  return (
    <div className="shell" data-menu={menu ? 'open' : 'closed'}>
      <a className="skip" href="#conteudo" onClick={(e) => { e.preventDefault(); document.getElementById("conteudo")?.focus(); }}>Ir para o conteúdo</a>
      <header className="topbar" ref={bar}>
        <a className="brand" href="#/">{state.tournament?.name ?? 'playTorneios'}</a>
        <button type="button" className="btn sm menu-btn" aria-expanded={menu} aria-controls="menu-principal" onClick={() => setMenu((v) => !v)}>
          <Icon name="list" />Menu
        </button>
        <Button variant="primary" icon="play" onClick={() => go('/resultados?registrar=1')}>Registrar placar</Button>
        <SyncChip />
        <div className="topbar-extra">
          <GlobalSearch />
          <TournamentSwitcher currentId={state.tournament?.id} />
          <Button size="sm" icon="sun" pressed={contrast === 'light'} onClick={() => setContrast(contrast === 'light' ? 'dark' : 'light')}>
            Modo sol
          </Button>
          {session && <span className="muted small">{session.email}</span>}
          {session && <Button size="sm" onClick={() => (unsent > 0 ? setOutOpen(true) : void signOut())}>Sair</Button>}
        </div>
      </header>
      <nav className="sidenav" id="menu-principal" aria-label="Principal" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMenu(false); }}>
        <div className="sidenav-in">
          {NAV.map((g) => (
            <div key={g.group ?? 'inicio'}>
              {g.group && <h2>{g.group}</h2>}
              <ul>
                {g.items.map((i) => {
                  const active = i.to === '/' ? here === '/' : here === i.to || here.startsWith(i.to + '/');
                  const note = notes[i.to];
                  return (
                    <li key={i.to}>
                      <a href={`#${i.to}`} aria-current={active ? 'page' : undefined}>
                        <Icon name={i.icon} />
                        <span>
                          {i.label}
                          {note && <><span className="sr-only">: </span><small className={`navnote${note.warn ? ' warn' : ''}`}>{note.text}</small></>}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
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
      <Dialog open={outOpen} title="Sair da conta" onClose={() => setOutOpen(false)} initialFocus="[data-safe]"
        footer={<><button className="btn" type="button" data-safe onClick={() => setOutOpen(false)}>Continuar logado</button><Button variant="danger" onClick={() => void signOut()}>Sair mesmo assim</Button></>}>
        <p>Há {unsent} alteração(ões) ainda não enviadas ao servidor. Elas continuam salvas neste aparelho e são enviadas quando você entrar de novo.</p>
      </Dialog>
    </div>
  );
}
