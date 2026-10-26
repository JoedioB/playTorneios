import { setProblem } from './scoring.ts';
import type { ScoreEntry } from './scoring.ts';
import type { ScoringRule, SetScore } from './types.ts';

/** Placar de quadra: sets já concluídos e os pontos do set em andamento (ou da partida, em ponto único). */
export interface Board {
  sets: SetScore[];
  a: number;
  b: number;
}

export type Side = 'a' | 'b';

export const emptyBoard = (): Board => ({ sets: [], a: 0, b: 0 });

export function boardFromLive(live?: { a: number; b: number; sets?: SetScore[] } | null): Board {
  if (!live) return emptyBoard();
  return { sets: (live.sets ?? []).map((s) => ({ a: s.a, b: s.b })), a: live.a, b: live.b };
}

/** Conteúdo da operação `match.live_score` para este placar (sets só quando houver sets concluídos). */
export function boardToLive(board: Board): { a: number; b: number; sets?: SetScore[] } {
  return board.sets.length > 0 ? { a: board.a, b: board.b, sets: board.sets.map((s) => ({ a: s.a, b: s.b })) } : { a: board.a, b: board.b };
}

function targetFor(rule: ScoringRule, setIndex: number): number {
  if (rule.model === 'target') return rule.targetPoints;
  const deciding = rule.bestOf > 1 && setIndex === rule.bestOf - 1;
  return deciding ? (rule.decidingSetPoints ?? rule.setPoints) : rule.setPoints;
}

/** O set (ou a partida de ponto único) acabou com estes pontos? */
export function setOver(rule: ScoringRule, setIndex: number, a: number, b: number): boolean {
  return setProblem(a, b, targetFor(rule, setIndex), rule.winBy, rule.cap) === null;
}

export function setsWon(board: Board): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const s of board.sets) {
    if (s.a > s.b) a++;
    else if (s.b > s.a) b++;
  }
  return { a, b };
}

/** Quem venceu a partida, ou null se ainda está em andamento. */
export function boardWinner(rule: ScoringRule, board: Board): Side | null {
  if (rule.model === 'target') return setOver(rule, 0, board.a, board.b) ? (board.a > board.b ? 'a' : 'b') : null;
  const need = Math.ceil(rule.bestOf / 2);
  const w = setsWon(board);
  if (w.a >= need) return 'a';
  if (w.b >= need) return 'b';
  return null;
}

/** Soma um ponto. Ao fechar um set, ele passa para a lista de sets e o próximo começa em 0 x 0. Depois de decidida, nada muda. */
export function addPoint(rule: ScoringRule, board: Board, side: Side): Board {
  if (boardWinner(rule, board)) return board;
  const next: Board = { sets: board.sets, a: board.a + (side === 'a' ? 1 : 0), b: board.b + (side === 'b' ? 1 : 0) };
  if (rule.model === 'sets' && setOver(rule, board.sets.length, next.a, next.b)) {
    return { sets: [...board.sets, { a: next.a, b: next.b }], a: 0, b: 0 };
  }
  return next;
}

/** Tira um ponto do lado indicado. Em 0 x 0, reabre o último set concluído. */
export function removePoint(rule: ScoringRule, board: Board, side: Side): Board {
  if (board[side] > 0) return { ...board, [side]: board[side] - 1 };
  if (rule.model === 'sets' && board.a === 0 && board.b === 0 && board.sets.length > 0) {
    const last = board.sets[board.sets.length - 1] as SetScore;
    const reopened: Board = { sets: board.sets.slice(0, -1), a: last.a, b: last.b };
    return reopened[side] > 0 ? { ...reopened, [side]: reopened[side] - 1 } : reopened;
  }
  return board;
}

/** Placar final no formato do resultado, ou null se a partida ainda não foi decidida. */
export function boardResult(rule: ScoringRule, board: Board): ScoreEntry | null {
  if (!boardWinner(rule, board)) return null;
  return rule.model === 'target' ? { points: { a: board.a, b: board.b } } : { sets: board.sets.map((s) => ({ a: s.a, b: s.b })) };
}

/** Texto curto para leitor de tela e para a tela: "1º set 18 x 15; em andamento 7 x 5". */
export function describeBoard(rule: ScoringRule, board: Board, nameA: string, nameB: string): string {
  const done = board.sets.map((s, i) => `${i + 1}º set ${s.a} a ${s.b}`);
  const win = boardWinner(rule, board);
  if (win) return `${[...done, rule.model === 'target' ? `final ${board.a} a ${board.b}` : ''].filter(Boolean).join('; ')}. Venceu ${win === 'a' ? nameA : nameB}.`;
  const now = rule.model === 'sets' ? `${board.sets.length + 1}º set em andamento ${board.a} a ${board.b}` : `${board.a} a ${board.b}`;
  return [...done, now].join('; ');
}
