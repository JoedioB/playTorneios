import type { Id, TieResolution, TiebreakerKey } from './types.ts';
import { sameSet } from './util.ts';

/** Partida concluída já reduzida a números. Quem monta é `resolve.ts` (aplica W.O., desistência etc.). */
export interface FinishedGame {
  matchId: Id;
  a: Id;
  b: Id;
  winner: Id;
  setsA: number;
  setsB: number;
  pointsA: number;
  pointsB: number;
}

export interface StandingRow {
  pairId: Id;
  played: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Posição final (1 = líder). Duplas empatadas sem desempate resolvido compartilham a posição. */
  position: number;
  /** Empate que os critérios automáticos não resolveram e que ainda não tem decisão manual. */
  tieUnresolved: boolean;
}

export interface GroupStandings {
  rows: StandingRow[];
  /** Conjuntos de duplas que aguardam decisão manual do organizador. */
  unresolvedTies: Id[][];
  complete: boolean;
}

type Totals = Omit<StandingRow, 'position' | 'tieUnresolved'>;

function totalsFor(pairIds: Id[], games: FinishedGame[]): Map<Id, Totals> {
  const map = new Map<Id, Totals>();
  for (const id of pairIds) {
    map.set(id, { pairId: id, played: 0, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0 });
  }
  for (const g of games) {
    const a = map.get(g.a);
    const b = map.get(g.b);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    if (g.winner === g.a) {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
    a.setsFor += g.setsA;
    a.setsAgainst += g.setsB;
    b.setsFor += g.setsB;
    b.setsAgainst += g.setsA;
    a.pointsFor += g.pointsA;
    a.pointsAgainst += g.pointsB;
    b.pointsFor += g.pointsB;
    b.pointsAgainst += g.pointsA;
  }
  return map;
}

function keyValue(key: TiebreakerKey, t: Totals): number | null {
  switch (key) {
    case 'wins':
      return t.wins;
    case 'set_diff':
      return t.setsFor - t.setsAgainst;
    case 'point_diff':
      return t.pointsFor - t.pointsAgainst;
    case 'points_for':
      return t.pointsFor;
    default:
      return null;
  }
}

/** Divide `cluster` em subgrupos ordenados do melhor para o pior segundo o critério. */
function splitBy(cluster: Id[], key: TiebreakerKey, totals: Map<Id, Totals>, games: FinishedGame[]): Id[][] {
  if (key === 'manual_draw') return [cluster];
  let values: Map<Id, number>;
  if (key === 'head_to_head') {
    const inner = games.filter((g) => cluster.includes(g.a) && cluster.includes(g.b));
    const mini = totalsFor(cluster, inner);
    values = new Map(cluster.map((id) => [id, (mini.get(id) as Totals).wins]));
  } else {
    values = new Map(cluster.map((id) => [id, keyValue(key, totals.get(id) as Totals) as number]));
  }
  const distinct = Array.from(new Set(values.values())).sort((x, y) => y - x);
  return distinct.map((v) => cluster.filter((id) => values.get(id) === v));
}

function resolveCluster(cluster: Id[], keys: TiebreakerKey[], totals: Map<Id, Totals>, games: FinishedGame[]): Id[][] {
  if (cluster.length <= 1) return [cluster];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as TiebreakerKey;
    if (key === 'manual_draw') continue;
    const parts = splitBy(cluster, key, totals, games);
    if (parts.length > 1) {
      const rest = keys.slice(i + 1);
      return parts.flatMap((p) => resolveCluster(p, rest, totals, games));
    }
  }
  return [cluster];
}

/**
 * Classificação de um grupo. Vitórias são sempre o primeiro critério; os demais seguem
 * `tiebreakers`. Empate residual só se resolve por `TieResolution` do organizador (SPECS §6.4).
 */
export function computeGroupStandings(
  pairIds: Id[],
  games: FinishedGame[],
  tiebreakers: TiebreakerKey[],
  ties: TieResolution[] = [],
  expectedGames?: number,
): GroupStandings {
  const totals = totalsFor(pairIds, games);
  const keys: TiebreakerKey[] = ['wins', ...tiebreakers.filter((k) => k !== 'wins')];
  const clusters = resolveCluster(pairIds.slice().sort(), keys, totals, games);

  const rows: StandingRow[] = [];
  const unresolvedTies: Id[][] = [];
  let position = 1;
  for (const cluster of clusters) {
    let ordered = cluster;
    let unresolved = false;
    if (cluster.length > 1) {
      const decision = ties.find((t) => sameSet(t.orderedPairIds, cluster));
      if (decision) {
        ordered = decision.orderedPairIds.slice();
        for (const id of ordered) rows.push(row(totals.get(id) as Totals, position++, false));
        continue;
      }
      // Sem nenhuma partida jogada ninguém está "empatado" de verdade: ainda não há o que decidir.
      const anyPlayed = cluster.some((id) => (totals.get(id) as Totals).played > 0);
      unresolved = anyPlayed;
      if (unresolved) unresolvedTies.push(cluster.slice());
      for (const id of ordered) rows.push(row(totals.get(id) as Totals, position, unresolved));
      position += cluster.length;
      continue;
    }
    rows.push(row(totals.get(cluster[0] as Id) as Totals, position++, false));
  }
  const need = expectedGames ?? (pairIds.length * (pairIds.length - 1)) / 2;
  return { rows, unresolvedTies, complete: games.length >= need };
}

function row(t: Totals, position: number, tieUnresolved: boolean): StandingRow {
  return { ...t, position, tieUnresolved };
}

/** Pódio a partir da final e da disputa de 3º. */
export interface Podium {
  first?: Id;
  second?: Id;
  third?: Id[]; // uma dupla (com disputa) ou duas (semifinalistas derrotados, sem disputa)
}
