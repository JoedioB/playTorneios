import { categoryMatches, resolveCategory } from './resolve.ts';
import type { ResolvedMatch } from './resolve.ts';
import type { Id, Match, Slot, TournamentState } from './types.ts';

const MIN = 60_000;

export interface Assignment {
  matchId: Id;
  courtId: Id;
  scheduledAt: string;
}

export interface ScheduleIssue {
  code: 'COURT_OVERLAP' | 'PAIR_OVERLAP' | 'PAIR_REST' | 'BEFORE_DEPENDENCY';
  matchIds: Id[];
  message: string;
}

export interface ScheduleOptions {
  startAt: string;
  courtIds: Id[];
  matchDurationMin?: number;
  restMin?: number;
  categoryIds?: Id[];
  /** Reagenda também partidas que já têm horário. */
  overwrite?: boolean;
}

function durationOf(state: TournamentState, m: Match): number {
  return m.durationMin ?? state.tournament?.defaults.matchDurationMin ?? 40;
}

function dependencies(slot: Slot): Id[] {
  return slot.kind === 'winnerOf' || slot.kind === 'loserOf' ? [slot.matchId] : [];
}

function groupDependencies(state: TournamentState, m: Match): Id[] {
  // Mata-mata alimentado por posição de grupo depende de todas as partidas daquele grupo.
  const out: Id[] = [];
  for (const slot of [m.slotA, m.slotB]) {
    if (slot.kind !== 'groupPosition') continue;
    for (const x of Object.values(state.matches)) if (x.groupId === slot.groupId) out.push(x.id);
  }
  return out;
}

function participants(r: ResolvedMatch | undefined): Id[] {
  if (!r) return [];
  return [r.a, r.b].flatMap((x) => (x.kind === 'pair' ? [x.pairId] : []));
}

/** Proposta de agenda gulosa: ordem por fase/rodada, respeitando quadras, descanso e dependências. */
export function proposeSchedule(state: TournamentState, opts: ScheduleOptions): Assignment[] {
  const rest = (opts.restMin ?? state.tournament?.defaults.restMin ?? 20) * MIN;
  const start = Date.parse(opts.startAt);
  if (Number.isNaN(start) || opts.courtIds.length === 0) return [];
  const categories = (opts.categoryIds ?? Object.keys(state.categories)).sort();

  const queue: Array<{ m: Match; res: ResolvedMatch | undefined }> = [];
  for (const cid of categories) {
    const res = resolveCategory(state, cid);
    for (const m of categoryMatches(state, cid)) queue.push({ m, res: res.matches[m.id] });
  }
  queue.sort((x, y) => {
    const px = x.m.phase === 'group' ? 0 : 1;
    const py = y.m.phase === 'group' ? 0 : 1;
    return px - py || x.m.round - y.m.round || x.m.categoryId.localeCompare(y.m.categoryId) || x.m.indexInRound - y.m.indexInRound;
  });

  const courtFree = new Map<Id, number>(opts.courtIds.map((c) => [c, start]));
  const pairFree = new Map<Id, number>();
  const endOf = new Map<Id, number>();
  const out: Assignment[] = [];

  // Partidas já agendadas (e não reagendadas) ocupam quadra e dupla.
  for (const { m, res } of queue) {
    if (m.scheduledAt && m.courtId && !opts.overwrite) {
      const t = Date.parse(m.scheduledAt);
      const end = t + durationOf(state, m) * MIN;
      endOf.set(m.id, end);
      if (courtFree.has(m.courtId)) courtFree.set(m.courtId, Math.max(courtFree.get(m.courtId) as number, end));
      for (const p of participants(res)) pairFree.set(p, Math.max(pairFree.get(p) ?? 0, end + rest));
    }
  }

  for (const { m, res } of queue) {
    if (res?.autoBye) continue;
    if (m.lifecycle === 'finished') continue;
    if (m.scheduledAt && m.courtId && !opts.overwrite) continue;
    const deps = [...dependencies(m.slotA), ...dependencies(m.slotB), ...groupDependencies(state, m)];
    let earliest = start;
    for (const d of deps) {
      const e = endOf.get(d);
      if (e !== undefined) earliest = Math.max(earliest, e + rest);
    }
    for (const p of participants(res)) earliest = Math.max(earliest, pairFree.get(p) ?? 0);
    let bestCourt = opts.courtIds[0] as Id;
    let bestAt = Infinity;
    for (const c of opts.courtIds) {
      const at = Math.max(earliest, courtFree.get(c) as number);
      if (at < bestAt) {
        bestAt = at;
        bestCourt = c;
      }
    }
    const end = bestAt + durationOf(state, m) * MIN;
    courtFree.set(bestCourt, end);
    endOf.set(m.id, end);
    for (const p of participants(res)) pairFree.set(p, end + rest);
    out.push({ matchId: m.id, courtId: bestCourt, scheduledAt: new Date(bestAt).toISOString() });
  }
  return out;
}

/** Conflitos da agenda atual: quadra duplicada, dupla em duas quadras, descanso curto, ordem das fases. */
export function detectScheduleIssues(state: TournamentState): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const rest = (state.tournament?.defaults.restMin ?? 20) * MIN;
  const resolved: Record<Id, ResolvedMatch> = {};
  for (const cid of Object.keys(state.categories)) Object.assign(resolved, resolveCategory(state, cid).matches);

  const scheduled = Object.values(state.matches)
    .filter((m) => m.scheduledAt && m.courtId && resolved[m.id] && !resolved[m.id]?.autoBye)
    .map((m) => ({ m, start: Date.parse(m.scheduledAt as string), end: Date.parse(m.scheduledAt as string) + durationOf(state, m) * MIN }))
    .sort((x, y) => x.start - y.start || x.m.id.localeCompare(y.m.id));

  for (let i = 0; i < scheduled.length; i++) {
    const x = scheduled[i] as (typeof scheduled)[number];
    for (let j = i + 1; j < scheduled.length; j++) {
      const y = scheduled[j] as (typeof scheduled)[number];
      if (y.start >= x.end + rest) break;
      if (x.m.courtId === y.m.courtId && y.start < x.end) {
        issues.push({ code: 'COURT_OVERLAP', matchIds: [x.m.id, y.m.id], message: 'Duas partidas ocupam a mesma quadra ao mesmo tempo.' });
      }
      const shared = participants(resolved[x.m.id]).filter((p) => participants(resolved[y.m.id]).includes(p));
      if (shared.length > 0) {
        if (y.start < x.end) {
          issues.push({ code: 'PAIR_OVERLAP', matchIds: [x.m.id, y.m.id], message: 'Uma dupla está escalada em duas partidas ao mesmo tempo.' });
        } else {
          issues.push({ code: 'PAIR_REST', matchIds: [x.m.id, y.m.id], message: 'Uma dupla tem menos descanso do que o mínimo configurado.' });
        }
      }
    }
  }
  for (const { m, start } of scheduled) {
    for (const d of [...dependencies(m.slotA), ...dependencies(m.slotB)]) {
      const dm = state.matches[d];
      if (dm?.scheduledAt && Date.parse(dm.scheduledAt) + durationOf(state, dm) * MIN > start) {
        issues.push({ code: 'BEFORE_DEPENDENCY', matchIds: [d, m.id], message: 'A partida está marcada antes de a anterior terminar.' });
      }
    }
  }
  return issues;
}
