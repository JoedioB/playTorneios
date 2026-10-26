import { resolveCategory } from './resolve.ts';
import type { Id, ScoringRule, SetScore, TournamentState } from './types.ts';

/** Visão MÍNIMA para o juiz de uma quadra (lista de permissão): nomes de exibição e o necessário para marcar pontos. */
export interface RefereeMatch {
  id: Id;
  label: string;
  categoryName: string;
  status: 'not_started' | 'in_progress' | 'finished';
  scheduledAt?: string;
  a: { id: Id; name: string } | null;
  b: { id: Id; name: string } | null;
  /** Só é possível abrir quando as duas duplas estão definidas. */
  ready: boolean;
  rule: ScoringRule;
  live?: { a: number; b: number; sets?: SetScore[] };
  result?: { kind: 'normal' | 'walkover' | 'retired'; sets?: SetScore[]; points?: { a: number; b: number }; winner: 'a' | 'b' };
}

export interface RefereeView {
  tournamentName: string;
  court: { id: Id; name: string };
  matches: RefereeMatch[];
}

const MAX_UPCOMING = 6;
const MAX_FINISHED = 3;

export function refereePairName(state: TournamentState, pairId: Id): string {
  const p = state.pairs[pairId];
  if (!p) return 'Dupla';
  if (p.displayName) return p.displayName;
  const a = state.athletes[p.athleteAId]?.fullName ?? '?';
  const b = state.athletes[p.athleteBId]?.fullName ?? '?';
  return `${a} / ${b}`;
}

export function buildRefereeView(state: TournamentState, courtId: Id): RefereeView | null {
  const court = state.courts[courtId];
  const t = state.tournament;
  if (!court || !t) return null;
  const items: Array<{ view: RefereeMatch; at: string; updatedAt: string }> = [];
  for (const m of Object.values(state.matches)) {
    if (m.courtId !== courtId) continue;
    const cat = state.categories[m.categoryId];
    if (!cat) continue;
    const rm = resolveCategory(state, m.categoryId).matches[m.id];
    if (!rm || rm.autoBye) continue;
    const a = rm.a.kind === 'pair' ? { id: rm.a.pairId, name: refereePairName(state, rm.a.pairId) } : null;
    const b = rm.b.kind === 'pair' ? { id: rm.b.pairId, name: refereePairName(state, rm.b.pairId) } : null;
    const view: RefereeMatch = {
      id: m.id,
      label: m.label,
      categoryName: cat.name,
      status: m.lifecycle,
      ...(m.scheduledAt ? { scheduledAt: m.scheduledAt } : {}),
      a,
      b,
      ready: !!a && !!b,
      rule: m.phase === 'group' ? (cat.groupScoring ?? cat.scoring) : cat.scoring,
    };
    if (m.lifecycle === 'in_progress' && m.live) {
      view.live = { a: m.live.a, b: m.live.b, ...(m.live.sets && m.live.sets.length > 0 ? { sets: m.live.sets.map((s) => ({ a: s.a, b: s.b })) } : {}) };
    }
    const r = rm.result;
    if (r && r.kind !== 'pending') {
      view.result = {
        kind: r.kind,
        ...(r.sets ? { sets: r.sets.map((s) => ({ a: s.a, b: s.b })) } : {}),
        ...(r.points ? { points: { a: r.points.a, b: r.points.b } } : {}),
        winner: a && r.winnerPairId === a.id ? 'a' : 'b',
      };
    }
    items.push({ view, at: m.scheduledAt ?? '9999', updatedAt: m.updatedAt });
  }
  const byTime = (x: { at: string; view: RefereeMatch }, y: { at: string; view: RefereeMatch }) => x.at.localeCompare(y.at) || x.view.label.localeCompare(y.view.label);
  const live = items.filter((i) => i.view.status === 'in_progress').sort(byTime);
  const upcoming = items.filter((i) => i.view.status === 'not_started').sort(byTime).slice(0, MAX_UPCOMING);
  const done = items.filter((i) => i.view.status === 'finished').sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).slice(0, MAX_FINISHED);
  return { tournamentName: t.name, court: { id: court.id, name: court.name }, matches: [...live, ...upcoming, ...done].map((i) => i.view) };
}
