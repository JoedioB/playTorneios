import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { addPoint, boardResult, boardWinner, describeBoard, describeRule, removePoint, setsWon } from '@playtorneios/domain';
import type { Board, ScoreEntry, ScoringRule, Side } from '@playtorneios/domain';

/**
 * Placar de quadra, só de apresentação: usado na tela do organizador e na página do juiz.
 * Não importa o runtime nem o kit do organizador, para a página do juiz continuar leve.
 */
export interface ScoreboardProps {
  rule: ScoringRule;
  nameA: string;
  nameB: string;
  board: Board;
  title: string;
  subtitle?: string;
  /** Recebe o novo placar a cada ponto lançado ou desfeito. */
  onBoardChange: (next: Board) => void;
  /** Chamado ao confirmar o fim da partida, já com o placar no formato do resultado. */
  onFinish: (entry: ScoreEntry) => void;
  disabled?: boolean;
  busy?: boolean;
  notice?: ReactNode;
  onExit?: () => void;
  exitLabel?: string;
}

/** Mantém a tela acesa enquanto o placar está aberto (quando o navegador permite). */
function useWakeLock(): void {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const ask = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        if (nav.wakeLock && document.visibilityState === 'visible') lock = await nav.wakeLock.request('screen');
        if (!alive && lock) void lock.release();
      } catch { /* sem permissão: segue sem manter a tela acesa */ }
    };
    void ask();
    const onVis = () => { if (document.visibilityState === 'visible') void ask(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); if (lock) void lock.release().catch(() => {}); };
  }, []);
}

export function Scoreboard(props: ScoreboardProps) {
  const { rule, board } = props;
  const [history, setHistory] = useState<Side[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [announce, setAnnounce] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  useWakeLock();

  const winner = boardWinner(rule, board);
  const result = boardResult(rule, board);
  const won = setsWon(board);
  const locked = !!props.disabled || !!winner;
  const names = { a: props.nameA, b: props.nameB } as const;

  const say = (b: Board) => setAnnounce(describeBoard(rule, b, props.nameA, props.nameB));
  const point = (side: Side) => {
    if (locked) return;
    const next = addPoint(rule, board, side);
    if (next === board) return;
    setHistory((h) => [...h.slice(-199), side]);
    props.onBoardChange(next);
    say(next);
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last || props.disabled) return;
    const next = removePoint(rule, board, last);
    setHistory((h) => h.slice(0, -1));
    setConfirming(false);
    props.onBoardChange(next);
    say(next);
  };
  const fix = (side: Side) => {
    if (props.disabled) return;
    const next = removePoint(rule, board, side);
    if (next === board) return;
    setConfirming(false);
    props.onBoardChange(next);
    say(next);
  };
  useEffect(() => { if (confirming) confirmRef.current?.focus(); }, [confirming]);

  return (
    <main id="conteudo" className="scoreboard" aria-label={`Placar: ${props.title}`}>
      <header className="sb-head">
        <div>
          <h1 className="sb-title">{props.title}</h1>
          {props.subtitle && <p className="muted small">{props.subtitle}</p>}
          <p className="muted small">{describeRule(rule)}</p>
        </div>
        {props.onExit && <button type="button" className="btn sm" onClick={props.onExit}>{props.exitLabel ?? 'Sair do placar'}</button>}
      </header>
      {props.notice}
      {rule.model === 'sets' && (
        <p className="sb-sets num" aria-label={`Sets: ${props.nameA} ${won.a}, ${props.nameB} ${won.b}`}>
          Sets {won.a} × {won.b}
          {board.sets.length > 0 && <span className="muted"> · {board.sets.map((s) => `${s.a}-${s.b}`).join(' · ')}</span>}
        </p>
      )}
      <div className="sb-sides">
        {(['a', 'b'] as const).map((side) => (
          <section key={side} className={`sb-side ${winner === side ? 'win' : ''}`} aria-label={names[side]}>
            <h2 className="sb-name">{names[side]}</h2>
            <p className="sb-score num" aria-hidden="true">{board[side]}</p>
            <button
              type="button"
              className="btn plus sb-plus"
              aria-label={`Ponto para ${names[side]}`}
              disabled={locked}
              onClick={() => point(side)}
            >
              +1
            </button>
          </section>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</p>
      <div className="sb-actions">
        <button type="button" className="btn" disabled={history.length === 0 || !!props.disabled} onClick={undo}>Desfazer último ponto</button>
        <button type="button" className="btn sm" disabled={!!props.disabled || board.a === 0} onClick={() => fix('a')} aria-label={`Tirar um ponto de ${props.nameA}`}>− {shortName(props.nameA)}</button>
        <button type="button" className="btn sm" disabled={!!props.disabled || board.b === 0} onClick={() => fix('b')} aria-label={`Tirar um ponto de ${props.nameB}`}>− {shortName(props.nameB)}</button>
      </div>
      {winner && result && (
        <section className="card sb-final" aria-label="Fim da partida">
          <h2>{names[winner]} venceu</h2>
          <p className="num">{finalText(rule, board)}</p>
          {!confirming ? (
            <button type="button" className="btn primary" disabled={!!props.disabled || !!props.busy} onClick={() => setConfirming(true)}>Finalizar partida</button>
          ) : (
            <div role="group" aria-label="Confirmar placar" className="stack">
              <p>Confirmar o placar final? Depois de enviado, só o organizador pode corrigir.</p>
              <div className="row">
                <button ref={confirmRef} type="button" className="btn primary" disabled={!!props.busy} onClick={() => props.onFinish(result)}>Confirmar placar</button>
                <button type="button" className="btn" onClick={() => setConfirming(false)}>Voltar</button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

const shortName = (n: string): string => (n.length > 14 ? `${n.slice(0, 13)}…` : n);

function finalText(rule: ScoringRule, board: Board): string {
  if (rule.model === 'target') return `${board.a} × ${board.b}`;
  return board.sets.map((s) => `${s.a}-${s.b}`).join(' · ');
}
