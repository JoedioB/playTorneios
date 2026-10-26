import type { BracketMeta, GroupDef, Id, Match, Slot } from './types.ts';
import { groupLetter, isPowerOfTwo, mulberry32, nextPowerOfTwo, shuffle } from './util.ts';
import type { Rng } from './util.ts';

export interface SeededPair {
  pairId: Id;
  seed?: number;
}

export interface BracketPlan {
  matches: Match[];
  meta: Omit<BracketMeta, 'id' | 'tournamentId' | 'categoryId' | 'generatedAt' | 'updatedAt'>;
}

export interface BracketContext {
  tournamentId: Id;
  categoryId: Id;
  now: string;
}

export class BracketError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Posições canônicas de uma chave de `size` (potência de 2): devolve o número da semente em cada posição. */
export function seedPositions(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinal';
  if (fromEnd === 2) return 'Quartas de final';
  if (fromEnd === 3) return 'Oitavas de final';
  return `Rodada ${round}`;
}

function makeMatch(ctx: BracketContext, partial: Pick<Match, 'id' | 'phase' | 'round' | 'indexInRound' | 'label' | 'slotA' | 'slotB'> & { groupId?: Id }): Match {
  return {
    tournamentId: ctx.tournamentId,
    categoryId: ctx.categoryId,
    lifecycle: 'not_started',
    updatedAt: ctx.now,
    ...partial,
  };
}

export const knockoutMatchId = (categoryId: Id, round: number, index: number): Id => `${categoryId}:K:${round}:${index}`;
export const thirdPlaceMatchId = (categoryId: Id): Id => `${categoryId}:K3`;
export const groupId = (categoryId: Id, index: number): Id => `${categoryId}:grp:${index}`;
export const groupMatchId = (categoryId: Id, g: number, round: number, index: number): Id => `${categoryId}:G:${g}:${round}:${index}`;

function validateSeeds(pairs: SeededPair[]): void {
  const seen = new Set<number>();
  for (const p of pairs) {
    if (p.seed === undefined) continue;
    if (!Number.isInteger(p.seed) || p.seed < 1 || p.seed > pairs.length) {
      throw new BracketError('SEED_INVALID', `A semente ${p.seed} precisa ser um número inteiro de 1 a ${pairs.length}.`);
    }
    if (seen.has(p.seed)) throw new BracketError('SEED_DUPLICATE', `A semente ${p.seed} foi atribuída a mais de uma dupla.`);
    seen.add(p.seed);
  }
}

/** Ordena as duplas por número de semente: as semeadas ocupam seus números, as demais são sorteadas nos livres. */
export function assignSeedOrder(pairs: SeededPair[], rng: Rng): Id[] {
  validateSeeds(pairs);
  const n = pairs.length;
  const slots: (Id | null)[] = new Array(n).fill(null);
  for (const p of pairs) if (p.seed !== undefined) slots[p.seed - 1] = p.pairId;
  const unseeded = shuffle(
    pairs.filter((p) => p.seed === undefined).map((p) => p.pairId),
    rng,
  );
  let k = 0;
  for (let i = 0; i < n; i++) if (slots[i] === null) slots[i] = unseeded[k++] as Id;
  return slots as Id[];
}

/** Monta as rodadas de uma chave eliminatória a partir de uma lista de slots por semente (1..size). */
function buildKnockout(
  ctx: BracketContext,
  seedSlots: (Slot | null)[], // índice = semente-1; null = bye (semente além do número de participantes)
  size: number,
  thirdPlace: boolean,
): Match[] {
  const totalRounds = Math.log2(size);
  const positions = seedPositions(size);
  const matches: Match[] = [];
  const slotFor = (seed: number): Slot => seedSlots[seed - 1] ?? { kind: 'bye' };

  for (let i = 0; i < size / 2; i++) {
    const a = positions[2 * i] as number;
    const b = positions[2 * i + 1] as number;
    matches.push(
      makeMatch(ctx, {
        id: knockoutMatchId(ctx.categoryId, 1, i),
        phase: 'knockout',
        round: 1,
        indexInRound: i,
        label: totalRounds === 1 ? 'Final' : `${roundName(1, totalRounds)} · jogo ${i + 1}`,
        slotA: slotFor(a),
        slotB: slotFor(b),
      }),
    );
  }
  for (let r = 2; r <= totalRounds; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      matches.push(
        makeMatch(ctx, {
          id: knockoutMatchId(ctx.categoryId, r, i),
          phase: 'knockout',
          round: r,
          indexInRound: i,
          label: r === totalRounds ? 'Final' : `${roundName(r, totalRounds)} · jogo ${i + 1}`,
          slotA: { kind: 'winnerOf', matchId: knockoutMatchId(ctx.categoryId, r - 1, 2 * i) },
          slotB: { kind: 'winnerOf', matchId: knockoutMatchId(ctx.categoryId, r - 1, 2 * i + 1) },
        }),
      );
    }
  }
  if (thirdPlace && totalRounds >= 2) {
    const semiRound = totalRounds - 1;
    matches.push(
      makeMatch(ctx, {
        id: thirdPlaceMatchId(ctx.categoryId),
        phase: 'knockout',
        round: totalRounds,
        indexInRound: 1,
        label: 'Disputa de 3º lugar',
        slotA: { kind: 'loserOf', matchId: knockoutMatchId(ctx.categoryId, semiRound, 0) },
        slotB: { kind: 'loserOf', matchId: knockoutMatchId(ctx.categoryId, semiRound, 1) },
      }),
    );
  }
  return matches;
}

/** A disputa de 3º só existe quando as duas semifinais têm perdedor real (sem bye). */
export function thirdPlaceFeasible(participants: number): boolean {
  const size = nextPowerOfTwo(participants);
  if (size < 4) return false;
  if (size === 4 && participants < 4) return false;
  return true;
}

export function generateSingleElimination(
  ctx: BracketContext,
  input: { pairs: SeededPair[]; thirdPlace: boolean; seed: number },
): BracketPlan {
  const n = input.pairs.length;
  if (n < 2) throw new BracketError('TOO_FEW_PAIRS', 'A eliminação simples precisa de pelo menos 2 duplas aprovadas.');
  const rng = mulberry32(input.seed);
  const order = assignSeedOrder(input.pairs, rng);
  const size = nextPowerOfTwo(n);
  const seedSlots: (Slot | null)[] = [];
  for (let s = 1; s <= size; s++) seedSlots.push(s <= n ? { kind: 'pair', pairId: order[s - 1] as Id } : null);
  const matches = buildKnockout(ctx, seedSlots, size, input.thirdPlace && thirdPlaceFeasible(n));
  return {
    matches,
    meta: { format: 'single_elimination', seed: input.seed, algorithm: 'v1', size, byes: size - n },
  };
}

export interface FormatSuggestion {
  groups: number;
  advancePerGroup: number;
  groupSizes: number[];
  advancing: number;
  bracketSize: number;
}

export interface FormatValidation {
  ok: boolean;
  errors: string[];
  suggestions: FormatSuggestion[];
}

export const MIN_GROUP_SIZE = 3;

export function groupSizesFor(pairCount: number, groups: number): number[] {
  const base = Math.floor(pairCount / groups);
  const extra = pairCount % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

export function validateFormat(
  format: 'single_elimination' | 'groups_then_knockout',
  pairCount: number,
  config: { groups?: number; advancePerGroup?: number } = {},
): FormatValidation {
  const errors: string[] = [];
  if (format === 'single_elimination') {
    if (pairCount < 2) errors.push('A eliminação simples precisa de pelo menos 2 duplas aprovadas.');
    return { ok: errors.length === 0, errors, suggestions: [] };
  }
  const suggestions: FormatSuggestion[] = [];
  for (let g = 2; g <= Math.floor(pairCount / MIN_GROUP_SIZE); g++) {
    const sizes = groupSizesFor(pairCount, g);
    const minSize = Math.min(...sizes);
    for (let adv = 1; adv <= Math.min(2, minSize - 1); adv++) {
      const advancing = g * adv;
      if (advancing < 2) continue;
      suggestions.push({ groups: g, advancePerGroup: adv, groupSizes: sizes, advancing, bracketSize: nextPowerOfTwo(advancing) });
    }
  }
  const { groups, advancePerGroup } = config;
  if (!groups || !advancePerGroup) {
    errors.push('Informe a quantidade de grupos e quantas duplas classificam por grupo.');
    return { ok: false, errors, suggestions };
  }
  if (groups < 2) errors.push('A fase de grupos precisa de pelo menos 2 grupos.');
  const sizes = groupSizesFor(pairCount, Math.max(groups, 1));
  if (Math.min(...sizes) < MIN_GROUP_SIZE) {
    errors.push(`Com ${pairCount} duplas e ${groups} grupos, algum grupo ficaria com menos de ${MIN_GROUP_SIZE} duplas.`);
  }
  if (advancePerGroup < 1 || advancePerGroup >= Math.min(...sizes)) {
    errors.push('Precisa classificar ao menos 1 dupla por grupo e ao menos 1 dupla de cada grupo deve ficar de fora.');
  }
  if (groups * advancePerGroup < 2) errors.push('A fase eliminatória precisa de pelo menos 2 classificados.');
  return { ok: errors.length === 0, errors, suggestions };
}

/** Distribui as duplas em grupos por serpentina a partir da ordem de semeadura. */
export function distributeSerpentine(order: Id[], groups: number): Id[][] {
  const out: Id[][] = Array.from({ length: groups }, () => []);
  order.forEach((pairId, i) => {
    const row = Math.floor(i / groups);
    const col = i % groups;
    const g = row % 2 === 0 ? col : groups - 1 - col;
    (out[g] as Id[]).push(pairId);
  });
  return out;
}

/** Rodadas de todos-contra-todos pelo método do círculo. Cada rodada é uma lista de confrontos. */
export function roundRobin(pairIds: Id[]): Array<Array<[Id, Id]>> {
  const list: (Id | null)[] = pairIds.slice();
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: Array<Array<[Id, Id]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const games: Array<[Id, Id]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i] as Id | null;
      const b = list[n - 1 - i] as Id | null;
      if (a !== null && b !== null) games.push([a, b]);
    }
    rounds.push(games);
    const last = list.pop() as Id | null;
    list.splice(1, 0, last);
  }
  return rounds;
}

/** Escolhe a ordem das 2ª, 3ª... colocações na chave para evitar reencontro do mesmo grupo na 1ª rodada. */
function chooseKnockoutSeeding(groupCount: number, advance: number): { positions: Array<{ g: number; pos: number }> } {
  const rows: number[][] = [];
  for (let pos = 1; pos <= advance; pos++) {
    const base = Array.from({ length: groupCount }, (_, g) => g);
    if (pos === 1) rows.push(base);
    else rows.push(base); // candidatos são avaliados abaixo
  }
  const advancing = groupCount * advance;
  const size = nextPowerOfTwo(advancing);
  const seedPos = seedPositions(size);
  const rotations = (arr: number[]): number[][] => {
    const out: number[][] = [];
    for (let r = 0; r < arr.length; r++) {
      out.push(arr.slice(r).concat(arr.slice(0, r)));
      out.push(out[out.length - 1]!.slice().reverse());
    }
    return out;
  };
  let best: { g: number; pos: number }[] | null = null;
  let bestScore = Infinity;
  const candidates = advance === 1 ? [rows[0] as number[]] : rotations(rows[1] as number[]);
  for (const second of candidates) {
    const list: { g: number; pos: number }[] = [];
    for (let g = 0; g < groupCount; g++) list.push({ g, pos: 1 });
    for (let pos = 2; pos <= advance; pos++) for (const g of second) list.push({ g, pos });
    let clashes = 0;
    for (let i = 0; i < size / 2; i++) {
      const a = list[(seedPos[2 * i] as number) - 1];
      const b = list[(seedPos[2 * i + 1] as number) - 1];
      if (a && b && a.g === b.g) clashes++;
    }
    if (clashes < bestScore) {
      bestScore = clashes;
      best = list;
    }
    if (clashes === 0) break;
  }
  return { positions: best as { g: number; pos: number }[] };
}

export function generateGroupsThenKnockout(
  ctx: BracketContext,
  input: { pairs: SeededPair[]; groups: number; advancePerGroup: number; thirdPlace: boolean; seed: number },
): BracketPlan {
  const n = input.pairs.length;
  const v = validateFormat('groups_then_knockout', n, { groups: input.groups, advancePerGroup: input.advancePerGroup });
  if (!v.ok) throw new BracketError('FORMAT_INVALID', v.errors.join(' '));
  const rng = mulberry32(input.seed);
  const order = assignSeedOrder(input.pairs, rng);
  const assignment = distributeSerpentine(order, input.groups);

  const groupDefs: GroupDef[] = assignment.map((pairIds, g) => ({
    id: groupId(ctx.categoryId, g),
    name: `Grupo ${groupLetter(g)}`,
    pairIds,
  }));

  const matches: Match[] = [];
  groupDefs.forEach((gd, g) => {
    const rounds = roundRobin(gd.pairIds);
    rounds.forEach((games, r) => {
      games.forEach(([a, b], i) => {
        matches.push(
          makeMatch(ctx, {
            id: groupMatchId(ctx.categoryId, g, r + 1, i),
            phase: 'group',
            groupId: gd.id,
            round: r + 1,
            indexInRound: i,
            label: `${gd.name} · rodada ${r + 1}`,
            slotA: { kind: 'pair', pairId: a },
            slotB: { kind: 'pair', pairId: b },
          }),
        );
      });
    });
  });

  const advancing = input.groups * input.advancePerGroup;
  const size = nextPowerOfTwo(advancing);
  const { positions } = chooseKnockoutSeeding(input.groups, input.advancePerGroup);
  const seedSlots: (Slot | null)[] = [];
  for (let s = 1; s <= size; s++) {
    const p = positions[s - 1];
    seedSlots.push(p ? { kind: 'groupPosition', groupId: (groupDefs[p.g] as GroupDef).id, position: p.pos } : null);
  }
  matches.push(...buildKnockout(ctx, seedSlots, size, input.thirdPlace && thirdPlaceFeasible(advancing)));
  return {
    matches,
    meta: {
      format: 'groups_then_knockout',
      seed: input.seed,
      algorithm: 'v1',
      size,
      byes: size - advancing,
      groups: groupDefs,
      advancePerGroup: input.advancePerGroup,
    },
  };
}

export function isBracketSizeValid(size: number): boolean {
  return isPowerOfTwo(size);
}
