import { computeGroupStandings } from './standings.ts';
import type { FinishedGame, GroupStandings } from './standings.ts';
import type { Category, Id, Match, ResultRevision, Slot, TournamentState } from './types.ts';

export type Resolved = { kind: 'pair'; pairId: Id } | { kind: 'bye' } | { kind: 'pending' };

export interface ResolvedMatch {
  a: Resolved;
  b: Resolved;
  winner: Resolved;
  loser: Resolved;
  /** Resultado válido e coerente com os participantes atuais. */
  result?: ResultRevision;
  /** Existe resultado registrado, mas os participantes da chave mudaram (SPECS §6.7). */
  stale: boolean;
  /** Partida sem adversário (bye): a dupla avança sem jogar. */
  autoBye: boolean;
}

export interface CategoryResolution {
  matches: Record<Id, ResolvedMatch>;
  groups: Record<Id, GroupStandings>;
}

export interface Outcome {
  first?: Id;
  second?: Id;
  /** Uma dupla com disputa de 3º; duas (empatadas) quando não há disputa. */
  third: Id[];
  complete: boolean;
}

/** Resultado vigente de uma partida: a revisão mais recente, se não foi invalidada. */
export function currentResult(revisions: ResultRevision[] | undefined): ResultRevision | undefined {
  if (!revisions || revisions.length === 0) return undefined;
  const last = revisions[revisions.length - 1] as ResultRevision;
  if (last.invalidatedAt || last.kind === 'pending') return undefined;
  return last;
}

export function categoryMatches(state: TournamentState, categoryId: Id): Match[] {
  return Object.values(state.matches)
    .filter((m) => m.categoryId === categoryId)
    .sort((x, y) => (x.phase === y.phase ? x.round - y.round || x.indexInRound - y.indexInRound : x.phase === 'group' ? -1 : 1));
}

function rawTotals(r: ResultRevision): { setsA: number; setsB: number; pointsA: number; pointsB: number } {
  if (r.sets && r.sets.length > 0) {
    let setsA = 0;
    let setsB = 0;
    let pointsA = 0;
    let pointsB = 0;
    for (const s of r.sets) {
      if (s.a > s.b) setsA++;
      else if (s.b > s.a) setsB++;
      pointsA += s.a;
      pointsB += s.b;
    }
    return { setsA, setsB, pointsA, pointsB };
  }
  if (r.points) {
    return { setsA: r.points.a > r.points.b ? 1 : 0, setsB: r.points.b > r.points.a ? 1 : 0, pointsA: r.points.a, pointsB: r.points.b };
  }
  return { setsA: 0, setsB: 0, pointsA: 0, pointsB: 0 };
}

export function toFinishedGame(matchId: Id, a: Id, b: Id, r: ResultRevision, category: Category): FinishedGame {
  const winner = r.winnerPairId as Id;
  let t = rawTotals(r);
  if (r.kind === 'walkover') {
    t = { setsA: 0, setsB: 0, pointsA: 0, pointsB: 0 };
    if (category.woCredit !== 'none') {
      const w = category.woCredit.winnerPoints;
      const l = category.woCredit.loserPoints;
      t.pointsA = winner === a ? w : l;
      t.pointsB = winner === a ? l : w;
    }
  }
  return { matchId, a, b, winner, ...t };
}

export function resolveCategory(state: TournamentState, categoryId: Id): CategoryResolution {
  const category = state.categories[categoryId] as Category | undefined;
  const matches = categoryMatches(state, categoryId);
  const byId = new Map(matches.map((m) => [m.id, m]));
  const memo = new Map<Id, ResolvedMatch>();
  const groupMemo = new Map<Id, GroupStandings>();
  const pending: Resolved = { kind: 'pending' };

  const groupGames = (groupId: Id): { games: FinishedGame[]; all: boolean } => {
    let all = true;
    const games: FinishedGame[] = [];
    for (const m of matches) {
      if (m.groupId !== groupId) continue;
      const rm = resolveMatch(m.id);
      if (rm.result && rm.a.kind === 'pair' && rm.b.kind === 'pair' && category) {
        games.push(toFinishedGame(m.id, rm.a.pairId, rm.b.pairId, rm.result, category));
      } else {
        all = false;
      }
    }
    return { games, all };
  };

  const groupStandings = (groupId: Id): GroupStandings => {
    const hit = groupMemo.get(groupId);
    if (hit) return hit;
    const def = Object.values(state.brackets)
      .flatMap((b) => b.groups ?? [])
      .find((g) => g.id === groupId);
    const { games } = groupGames(groupId);
    const expected = def ? (def.pairIds.length * (def.pairIds.length - 1)) / 2 : undefined;
    const ties = Object.values(state.ties).filter((t) => t.groupId === groupId);
    const gs = def
      ? computeGroupStandings(def.pairIds, games, category?.tiebreakers ?? ['head_to_head', 'set_diff', 'point_diff'], ties, expected)
      : { rows: [], unresolvedTies: [], complete: false };
    groupMemo.set(groupId, gs);
    return gs;
  };

  const resolveSlot = (slot: Slot): Resolved => {
    switch (slot.kind) {
      case 'pair':
        return { kind: 'pair', pairId: slot.pairId };
      case 'bye':
        return { kind: 'bye' };
      case 'winnerOf': {
        if (!byId.has(slot.matchId)) return pending;
        return resolveMatch(slot.matchId).winner;
      }
      case 'loserOf': {
        if (!byId.has(slot.matchId)) return pending;
        return resolveMatch(slot.matchId).loser;
      }
      case 'groupPosition': {
        const gs = groupStandings(slot.groupId);
        if (!gs.complete) return pending;
        const r = gs.rows.find((x) => x.position === slot.position);
        if (!r || r.tieUnresolved) return pending;
        return { kind: 'pair', pairId: r.pairId };
      }
    }
  };

  const resolveMatch = (id: Id): ResolvedMatch => {
    const hit = memo.get(id);
    if (hit) return hit;
    const m = byId.get(id) as Match;
    const a = resolveSlot(m.slotA);
    const b = resolveSlot(m.slotB);
    const out: ResolvedMatch = { a, b, winner: pending, loser: pending, stale: false, autoBye: false };
    memo.set(id, out); // evita laço em dados corrompidos

    const rev = currentResult(state.results[id]);
    if (a.kind === 'pair' && b.kind === 'pair') {
      if (rev) {
        const same = rev.participants[0] === a.pairId && rev.participants[1] === b.pairId;
        if (same && rev.winnerPairId && (rev.winnerPairId === a.pairId || rev.winnerPairId === b.pairId)) {
          out.result = rev;
          out.winner = { kind: 'pair', pairId: rev.winnerPairId };
          out.loser = { kind: 'pair', pairId: rev.winnerPairId === a.pairId ? b.pairId : a.pairId };
        } else {
          out.stale = true;
        }
      }
    } else if ((a.kind === 'pair' && b.kind === 'bye') || (a.kind === 'bye' && b.kind === 'pair')) {
      out.autoBye = true;
      out.winner = a.kind === 'pair' ? a : b;
      out.loser = { kind: 'bye' };
      if (rev) out.stale = true;
    } else if (a.kind === 'bye' && b.kind === 'bye') {
      out.autoBye = true;
      out.winner = { kind: 'bye' };
      out.loser = { kind: 'bye' };
    } else if (rev) {
      out.stale = true; // há resultado, mas um participante deixou de estar definido
    }
    return out;
  };

  const resolved: Record<Id, ResolvedMatch> = {};
  for (const m of matches) resolved[m.id] = resolveMatch(m.id);
  const groups: Record<Id, GroupStandings> = {};
  for (const b of Object.values(state.brackets)) {
    if (b.categoryId !== categoryId) continue;
    for (const g of b.groups ?? []) groups[g.id] = groupStandings(g.id);
  }
  return { matches: resolved, groups };
}

/** Partidas com resultado que deixaram de ser coerentes com a chave (e, em cascata, as dependentes). */
export function findInvalidResults(state: TournamentState, categoryId: Id): Id[] {
  const res = resolveCategory(state, categoryId);
  return Object.entries(res.matches)
    .filter(([, r]) => r.stale)
    .map(([id]) => id)
    .sort();
}

export function categoryOutcome(state: TournamentState, categoryId: Id, res = resolveCategory(state, categoryId)): Outcome {
  const ms = categoryMatches(state, categoryId).filter((m) => m.phase === 'knockout');
  if (ms.length === 0) return { third: [], complete: false };
  const maxRound = Math.max(...ms.map((m) => m.round));
  const final = ms.find((m) => m.round === maxRound && m.indexInRound === 0);
  const thirdMatch = ms.find((m) => m.round === maxRound && m.indexInRound === 1);
  const pairOf = (r: Resolved | undefined): Id | undefined => (r && r.kind === 'pair' ? r.pairId : undefined);
  const fr = final ? res.matches[final.id] : undefined;
  const out: Outcome = { first: pairOf(fr?.winner), second: pairOf(fr?.loser), third: [], complete: false };
  if (thirdMatch) {
    const t = pairOf(res.matches[thirdMatch.id]?.winner);
    if (t) out.third = [t];
  } else if (maxRound >= 2) {
    const semis = ms.filter((m) => m.round === maxRound - 1);
    for (const s of semis) {
      const l = pairOf(res.matches[s.id]?.loser);
      if (l) out.third.push(l);
    }
  }
  const needThird = thirdMatch ? 1 : Math.min(2, ms.filter((m) => m.round === maxRound - 1 && !res.matches[m.id]?.autoBye).length);
  out.complete = !!out.first && !!out.second && (maxRound < 2 || out.third.length >= needThird);
  return out;
}
