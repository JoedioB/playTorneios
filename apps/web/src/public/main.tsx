import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PublicSnapshot } from '@playtorneios/domain';
import '../ui/styles.css';
import { PublicView } from './PublicView.tsx';
import type { Conn } from './PublicView.tsx';
import { clockSkew } from './logic.ts';

// Tema: preferência salva > tema do aparelho. (Antes: sempre claro.) O botão "Modo sol / Tema escuro" troca e salva.
function startTheme(): 'dark' | 'light' {
  try { const v = localStorage.getItem('pt:contrast'); if (v === 'light' || v === 'dark') return v; } catch { /* sem armazenamento */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
document.documentElement.dataset.contrast = startTheme();

const POLL_MS = 15000; // consulta periódica (só com a aba visível); dobra a cada falha, até 60 s
const TIMEOUT_MS = 12000;

function Skeleton() {
  return (
    <main className="pv pv-state" aria-busy="true">
      <p className="sr-only" role="status">Carregando o torneio…</p>
      <div className="pv-skel" aria-hidden="true"><div /><div /><div className="b" /><div className="b" /><div /></div>
    </main>
  );
}

function PublicApp() {
  const slug = location.pathname.split('/').filter(Boolean)[1] ?? '';
  const [snap, setSnap] = useState<PublicSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [conn, setConn] = useState<Conn>({ fetchedAt: Date.now(), skewMs: 0, failing: false });
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true, fails = 0, skew = 0, timer: ReturnType<typeof setTimeout> | undefined, ctl: AbortController | undefined, last = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (document.visibilityState === 'visible') void load(); else schedule(); }, Math.min(POLL_MS * 2 ** Math.min(fails, 2), 60000));
    };
    const load = async () => {
      ctl?.abort();
      const c = (ctl = new AbortController());
      const to = setTimeout(() => c.abort(), TIMEOUT_MS);
      last = Date.now();
      try {
        // `no-cache`: sempre revalida com o servidor (ETag → 304 barato); evita ver placar "congelado" pelo cache HTTP.
        const r = await fetch(`/api/public/${encodeURIComponent(slug)}`, { cache: 'no-cache', signal: c.signal, headers: { accept: 'application/json' } });
        if (r.status === 404) { if (alive) setState('missing'); return; }
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as PublicSnapshot;
        if (!alive) return;
        fails = 0;
        // Relógio do servidor (cabeçalho Date): "há X" e "hoje" não dependem de o relógio do aparelho estar certo.
        skew = clockSkew(r.headers.get('date'), Date.now());
        setConn({ fetchedAt: Date.now() + skew, skewMs: skew, failing: false });
        setSnap((p) => (p && p.generatedAt === j.generatedAt ? p : j)); // igual ao anterior: não redesenha nada
        setState('ok');
      } catch {
        fails++;
        if (alive) { setConn((p) => ({ ...p, failing: fails >= 2 || navigator.onLine === false })); setState((s) => (s === 'ok' ? 'ok' : 'error')); }
      } finally { clearTimeout(to); if (alive) schedule(); }
    };
    loadRef.current = () => { clearTimeout(timer); void load(); };
    void load();
    const wake = () => { if (document.visibilityState === 'visible' && Date.now() - last > 5000) void load(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => { alive = false; clearTimeout(timer); ctl?.abort(); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
  }, [slug]);

  const retry = useCallback(() => loadRef.current(), []);
  if (state === 'loading') return <Skeleton />;
  if (state === 'missing') return <main className="pv pv-state"><h1>Torneio não encontrado</h1><p>Este torneio não está publicado ou o endereço mudou. Confira o link com o organizador.</p></main>;
  if (!snap) return <main className="pv pv-state"><h1>Sem conexão</h1><p role="status">Não foi possível carregar agora. Vamos tentar de novo sozinhos.</p><button type="button" className="pv-btn" onClick={retry}>Tentar agora</button></main>;
  return <PublicView snapshot={snap} conn={conn} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><PublicApp /></StrictMode>);
