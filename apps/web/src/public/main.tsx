import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PublicSnapshot } from '@playtorneios/domain';
import '../ui/styles.css';
import { PublicView } from './PublicView.tsx';

document.documentElement.dataset.contrast = 'light'; // leitura ao sol por padrão (SPECS §10.4)

function PublicApp() {
  const slug = location.pathname.split('/').filter(Boolean)[1] ?? '';
  const [snap, setSnap] = useState<PublicSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/public/${encodeURIComponent(slug)}`);
        if (r.status === 404) { if (alive) setState('missing'); return; }
        if (!r.ok) throw new Error(String(r.status));
        if (alive) { setSnap(await r.json()); setState('ok'); }
      } catch { if (alive) setState((s) => (s === 'ok' ? 'ok' : 'error')); }
    };
    void load();
    const iv = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [slug]);
  if (state === 'loading') return <p role="status" style={{ padding: '2rem' }}>Carregando…</p>;
  if (state === 'missing') return <main style={{ padding: '2rem' }}><h1>Torneio não encontrado</h1><p>Este torneio não está publicado ou o endereço mudou.</p></main>;
  if (state === 'error' && !snap) return <main style={{ padding: '2rem' }}><h1>Sem conexão</h1><p>Não foi possível carregar agora. Tente de novo em instantes.</p></main>;
  return <PublicView snapshot={snap as PublicSnapshot} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><PublicApp /></StrictMode>);
