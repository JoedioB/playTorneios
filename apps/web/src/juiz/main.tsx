import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { boardFromLive, boardToLive, describeRule } from '@playtorneios/domain';
import type { Board, RefereeMatch, RefereeView, ScoreEntry } from '@playtorneios/domain';
import '../ui/styles.css';
import { Scoreboard } from '../ui/scoreboard.tsx';
import { enqueue, loadQueue, saveQueue } from './queue.ts';
import type { QueuedCommand } from './queue.ts';

document.documentElement.dataset.contrast = 'light'; // leitura ao sol por padrão

const TOKEN_KEY = 'pt_ref_token';
const BOARDS_KEY = 'pt_ref_boards';

function readToken(): string | null {
  try {
    const frag = location.hash.replace(/^#/, '');
    if (frag) {
      sessionStorage.setItem(TOKEN_KEY, frag);
      history.replaceState(null, '', location.pathname); // o token sai da barra de endereço
    }
    return sessionStorage.getItem(TOKEN_KEY);
  } catch { return null; }
}

const uuid = (): string => crypto.randomUUID();
const CSRF = { 'x-playtorneios': 'referee' };

type Status = 'loading' | 'ok' | 'ended' | 'error';
interface PushResult { opId: string; status: string; error?: { code: string; message: string } }

const REJECT_TEXT: Record<string, string> = {
  ALREADY_RECORDED: 'O organizador já registrou o resultado desta partida.',
  FORBIDDEN_MATCH: 'Esta partida não é da sua quadra.',
  SCORE_INVALID: 'O placar enviado não é válido. Confira os pontos.',
};

function JuizApp() {
  const [token] = useState(readToken);
  const [view, setView] = useState<RefereeView | null>(null);
  const [status, setStatus] = useState<Status>(token ? 'loading' : 'ended');
  const [online, setOnline] = useState(true);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [boards, setBoards] = useState<Record<string, Board>>(() => {
    try { return JSON.parse(sessionStorage.getItem(BOARDS_KEY) ?? '{}') as Record<string, Board>; } catch { return {}; }
  });
  const [message, setMessage] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const queue = useRef<QueuedCommand[]>(loadQueue());
  const flushing = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const headers = useCallback(() => ({ ...CSRF, authorization: `Bearer ${token}`, 'content-type': 'application/json' }), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/referee/court', { headers: headers(), cache: 'no-store' });
      if (r.status === 401) { setStatus('ended'); return; }
      if (!r.ok) throw new Error(String(r.status));
      setView((await r.json()) as RefereeView);
      setStatus('ok');
      setOnline(true);
    } catch { setOnline(false); setStatus((s) => (s === 'loading' ? 'error' : s)); }
  }, [token, headers]);

  const flush = useCallback(async (): Promise<PushResult[]> => {
    if (!token || flushing.current || queue.current.length === 0) return [];
    flushing.current = true;
    const batch = queue.current.slice(0, 30);
    try {
      const r = await fetch('/api/referee/push', { method: 'POST', headers: headers(), body: JSON.stringify({ commands: batch }) });
      if (r.status === 401) { setStatus('ended'); return []; }
      if (r.status === 400 || r.status === 429) {
        if (r.status === 400) { queue.current = queue.current.slice(batch.length); saveQueue(queue.current); }
        return [];
      }
      if (!r.ok) throw new Error(String(r.status));
      const { results } = (await r.json()) as { results: PushResult[] };
      const done = new Set(results.map((x) => x.opId));
      queue.current = queue.current.filter((x) => !done.has(x.opId));
      saveQueue(queue.current);
      setOnline(true);
      for (const x of results) {
        if (x.status === 'rejected' && x.error && x.error.code !== 'MATCH_FINISHED') setMessage(REJECT_TEXT[x.error.code] ?? x.error.message);
      }
      return results;
    } catch { setOnline(false); return []; } finally { flushing.current = false; }
  }, [token, headers]);

  useEffect(() => { void load(); void flush(); }, [load, flush]);
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void flush();
      if (!matchId) void load(); // com uma partida aberta, a tela não muda sozinha
    }, 8000);
    const on = () => { void flush(); void load(); };
    addEventListener('online', on);
    return () => { clearInterval(iv); removeEventListener('online', on); };
  }, [flush, load, matchId]);
  useEffect(() => { try { sessionStorage.setItem(BOARDS_KEY, JSON.stringify(boards)); } catch { /* ok */ } }, [boards]);

  const send = (c: QueuedCommand, immediate = false) => {
    queue.current = enqueue(queue.current, c);
    saveQueue(queue.current);
    window.clearTimeout(timer.current);
    // junta pontos seguidos: o servidor só precisa do último placar
    timer.current = window.setTimeout(() => void flush(), immediate ? 0 : 700);
  };

  const open = (m: RefereeMatch) => {
    setMessage('');
    setBoards((b) => (b[m.id] ? b : { ...b, [m.id]: boardFromLive(m.live) }));
    if (m.status === 'not_started') send({ opId: uuid(), type: 'match.start', payload: { matchId: m.id } }, true);
    setMatchId(m.id);
  };

  if (!token || status === 'ended') {
    const saved = matchId && boards[matchId];
    return (
      <main id="conteudo" className="scoreboard">
        <h1>Link encerrado</h1>
        <p>{token ? 'Este link foi revogado ou venceu.' : 'Abra o link ou o QR code da sua quadra.'} Peça um novo ao organizador.</p>
        {saved && view && <p className="banner" role="status">O placar que estava na tela continua salvo neste aparelho e será enviado quando houver um link válido.</p>}
      </main>
    );
  }
  if (status === 'loading') return <p role="status" style={{ padding: '2rem' }}>Carregando a quadra…</p>;
  if (!view) return <main id="conteudo" className="scoreboard"><h1>Sem conexão</h1><p>Não foi possível carregar agora.</p><button type="button" className="btn primary" onClick={() => void load()}>Tentar de novo</button></main>;

  const match = matchId ? view.matches.find((x) => x.id === matchId) : undefined;
  const banner = !online ? <p className="banner" role="status">Sem conexão. Seus pontos estão guardados neste aparelho e serão enviados quando o sinal voltar.</p> : null;

  if (match && match.a && match.b) {
    const board = boards[match.id] ?? boardFromLive(match.live);
    const finished = match.status === 'finished' || !!match.result;
    return (
      <Scoreboard
        rule={match.rule}
        nameA={match.a.name}
        nameB={match.b.name}
        board={board}
        title={match.label}
        subtitle={`${view.court.name} · ${match.categoryName}`}
        disabled={finished}
        busy={busy}
        notice={<>{banner}{message && <p className="banner" role="alert">{message}</p>}{finished && <p className="banner" role="status">Partida encerrada.</p>}</>}
        onBoardChange={(next) => {
          setBoards((b) => ({ ...b, [match.id]: next }));
          send({ opId: uuid(), type: 'match.live_score', payload: { matchId: match.id, ...boardToLive(next) } });
        }}
        onFinish={(entry: ScoreEntry) => {
          setBusy(true);
          send({
            opId: uuid(),
            type: 'result.record',
            payload: { resultId: uuid(), matchId: match.id, kind: 'normal', sets: entry.sets, points: entry.points, expectedA: match.a?.id, expectedB: match.b?.id },
          }, true);
          void (async () => {
            await flush();
            await load();
            setBusy(false);
            if (queue.current.length === 0) setMatchId(null);
          })();
        }}
        onExit={() => { setMatchId(null); void load(); }}
        exitLabel="Voltar à lista"
      />
    );
  }

  const current = view.matches.filter((m) => m.status === 'in_progress');
  const next = view.matches.filter((m) => m.status === 'not_started');
  const done = view.matches.filter((m) => m.status === 'finished');
  const row = (m: RefereeMatch) => (
    <li key={m.id} className="card row">
      <span className="grow">
        <strong>{m.label}</strong> · <span className="muted small">{m.categoryName}</span>
        <br />{m.a?.name ?? 'A definir'} × {m.b?.name ?? 'A definir'}
        <br /><span className="muted small">{describeRule(m.rule)}</span>
      </span>
      {m.status !== 'finished' && (
        <button type="button" className="btn primary" disabled={!m.ready} onClick={() => open(m)}>
          {m.status === 'in_progress' ? 'Continuar' : 'Abrir partida'}
        </button>
      )}
    </li>
  );
  return (
    <main id="conteudo" className="scoreboard">
      <header>
        <h1 className="sb-title">{view.court.name}</h1>
        <p className="muted small">{view.tournamentName}</p>
      </header>
      {banner}
      {message && <p className="banner" role="alert">{message}</p>}
      {current.length > 0 && <section aria-label="Em andamento" className="stack"><h2>Em andamento</h2><ul className="stack" style={{ listStyle: 'none', padding: 0 }}>{current.map(row)}</ul></section>}
      <section aria-label="Próximas partidas" className="stack">
        <h2>Próximas</h2>
        {next.length === 0 ? <p className="muted">Nenhuma partida pendente nesta quadra.</p> : <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>{next.map(row)}</ul>}
      </section>
      {done.length > 0 && <section aria-label="Encerradas" className="stack"><h2>Encerradas</h2><ul className="stack" style={{ listStyle: 'none', padding: 0 }}>{done.map(row)}</ul></section>}
      <button type="button" className="btn" onClick={() => void load()}>Atualizar lista</button>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><JuizApp /></StrictMode>);
