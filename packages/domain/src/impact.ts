import type { BracketPlan } from './bracket.ts';
import { categoryMatches, resolveCategory } from './resolve.ts';
import type { ResolvedMatch } from './resolve.ts';
import type { BracketMeta, Id, ResultRevision, TournamentState } from './types.ts';
import { canonicalJson, fnv1a } from './util.ts';

export interface ImpactItem {
  matchId: Id;
  label: string;
  message: string;
}

export interface ImpactReport {
  preserved: Id[];
  invalidated: ImpactItem[];
  /** Partidas que perdem o horário/quadra porque os participantes mudaram. */
  lostSchedules: ImpactItem[];
  blocking: boolean;
  blockingReason?: string;
  /** Linhas em português para a tela de confirmação. */
  lines: string[];
  /** Token que precisa acompanhar o comando de confirmação. Muda se o estado mudar. */
  token: string;
  hasImpact: boolean;
}

const participantsKey = (r: ResolvedMatch | undefined): string => {
  if (!r) return '';
  const f = (x: ResolvedMatch['a']): string => (x.kind === 'pair' ? x.pairId : x.kind);
  return `${f(r.a)}|${f(r.b)}`;
};

export function fingerprint(state: TournamentState, categoryId: Id): string {
  const matches = categoryMatches(state, categoryId).map((m) => [m.id, m.slotA, m.slotB, m.scheduledAt ?? null, m.courtId ?? null]);
  const results = categoryMatches(state, categoryId).map((m) => [
    m.id,
    (state.results[m.id] ?? []).map((r) => [r.revision, r.winnerPairId, r.invalidatedAt ?? null]),
  ]);
  const regs = Object.values(state.registrations)
    .filter((r) => r.categoryId === categoryId)
    .map((r) => [r.id, r.status, r.seed ?? null])
    .sort();
  return fnv1a(canonicalJson({ matches, results, regs }));
}

function labelOf(state: TournamentState, id: Id): string {
  return state.matches[id]?.label ?? id;
}

function hypotheticalWithPlan(state: TournamentState, categoryId: Id, plan: BracketPlan, now: string): TournamentState {
  const next: TournamentState = { ...state, matches: { ...state.matches }, brackets: { ...state.brackets } };
  for (const m of categoryMatches(state, categoryId)) delete next.matches[m.id];
  for (const m of plan.matches) {
    const old = state.matches[m.id];
    next.matches[m.id] = old
      ? { ...m, courtId: old.courtId, scheduledAt: old.scheduledAt, durationMin: old.durationMin, lifecycle: old.lifecycle, ...(old.live ? { live: old.live } : {}) }
      : m;
  }
  const prev = state.brackets[categoryId];
  const meta: BracketMeta = {
    ...plan.meta,
    id: categoryId,
    tournamentId: state.tournament?.id ?? '',
    categoryId,
    generatedAt: prev?.generatedAt ?? now,
    updatedAt: now,
  };
  next.brackets[categoryId] = meta;
  return next;
}

/** Aplica o plano em um estado hipotético, retirando horários de partidas cujos participantes mudaram. */
export function applyPlanToState(state: TournamentState, categoryId: Id, plan: BracketPlan, now: string): TournamentState {
  const hyp = hypotheticalWithPlan(state, categoryId, plan, now);
  const before = resolveCategory(state, categoryId).matches;
  const after = resolveCategory(hyp, categoryId).matches;
  const matches = { ...hyp.matches };
  for (const m of plan.matches) {
    if (matches[m.id]?.scheduledAt && participantsKey(before[m.id]) !== participantsKey(after[m.id])) {
      const { courtId: _c, scheduledAt: _s, ...rest } = matches[m.id]!;
      matches[m.id] = rest;
    }
    // Duplas diferentes: o andamento da partida anterior não vale mais.
    if (matches[m.id] && participantsKey(before[m.id]) !== participantsKey(after[m.id])) {
      const { live: _l, ...rest } = matches[m.id]!;
      matches[m.id] = { ...rest, lifecycle: 'not_started' };
    }
  }
  return { ...hyp, matches };
}

export function analyzeBracketChange(state: TournamentState, categoryId: Id, plan: BracketPlan, now: string): ImpactReport {
  const before = resolveCategory(state, categoryId).matches;
  const hyp = hypotheticalWithPlan(state, categoryId, plan, now);
  const after = resolveCategory(hyp, categoryId);
  const planIds = new Set(plan.matches.map((m) => m.id));

  const invalidated: ImpactItem[] = [];
  const preserved: Id[] = [];
  for (const m of categoryMatches(state, categoryId)) {
    const revs = state.results[m.id];
    const had = revs && revs.length > 0 && !revs[revs.length - 1]!.invalidatedAt;
    if (!had) continue;
    if (!planIds.has(m.id)) {
      invalidated.push({ matchId: m.id, label: m.label, message: `${m.label}: a partida deixa de existir na nova chave; o resultado fica guardado no histórico.` });
    } else if (after.matches[m.id]?.stale) {
      invalidated.push({ matchId: m.id, label: m.label, message: `${m.label}: as duplas mudaram; o resultado será invalidado e fica guardado no histórico.` });
    } else {
      preserved.push(m.id);
    }
  }
  const lostSchedules: ImpactItem[] = [];
  for (const m of categoryMatches(state, categoryId)) {
    if (!m.scheduledAt) continue;
    if (!planIds.has(m.id) || participantsKey(before[m.id]) !== participantsKey(after.matches[m.id])) {
      lostSchedules.push({ matchId: m.id, label: m.label, message: `${m.label}: perde o horário e a quadra.` });
    }
  }
  const prev = state.brackets[categoryId];
  const anyResults = invalidated.length + preserved.length > 0;
  const blocking = !!prev && prev.format !== plan.meta.format && anyResults;
  const lines = [
    ...invalidated.map((i) => i.message),
    ...lostSchedules.map((i) => i.message),
    ...(preserved.length ? [`${preserved.length} resultado(s) continuam valendo.`] : []),
  ];
  const report: ImpactReport = {
    preserved,
    invalidated,
    lostSchedules,
    blocking,
    blockingReason: blocking ? 'Trocar o formato com resultados lançados não é permitido de uma só vez. Zere a chave antes ou mantenha o formato.' : undefined,
    lines,
    token: '',
    hasImpact: invalidated.length > 0 || lostSchedules.length > 0,
  };
  report.token = fnv1a(
    canonicalJson({ categoryId, fp: fingerprint(state, categoryId), plan: plan.matches.map((m) => [m.id, m.slotA, m.slotB]), invalidated: invalidated.map((i) => i.matchId) }),
  );
  return report;
}

/** Efeito de corrigir o vencedor de uma partida sobre as partidas seguintes. */
export function analyzeResultCorrection(state: TournamentState, matchId: Id, next: ResultRevision): ImpactReport {
  const m = state.matches[matchId];
  if (!m) throw new Error(`Partida ${matchId} inexistente`);
  const categoryId = m.categoryId;
  const before = resolveCategory(state, categoryId).matches;
  const hyp: TournamentState = { ...state, results: { ...state.results, [matchId]: [...(state.results[matchId] ?? []), next] } };
  const after = resolveCategory(hyp, categoryId);
  const invalidated: ImpactItem[] = [];
  const lostSchedules: ImpactItem[] = [];
  for (const other of categoryMatches(state, categoryId)) {
    if (other.id === matchId) continue;
    const had = (state.results[other.id] ?? []).at(-1);
    if (had && !had.invalidatedAt && after.matches[other.id]?.stale) {
      invalidated.push({ matchId: other.id, label: other.label, message: `${other.label}: as duplas mudam com a correção; o resultado será invalidado e fica no histórico.` });
    }
    if (other.scheduledAt && participantsKey(before[other.id]) !== participantsKey(after.matches[other.id])) {
      lostSchedules.push({ matchId: other.id, label: other.label, message: `${other.label}: muda de duplas; confira o horário.` });
    }
  }
  const lines = [...invalidated.map((i) => i.message), ...lostSchedules.map((i) => i.message)];
  return {
    preserved: [],
    invalidated,
    lostSchedules,
    blocking: false,
    lines,
    token: fnv1a(canonicalJson({ matchId, fp: fingerprint(state, categoryId), winner: next.winnerPairId, kind: next.kind, sets: next.sets ?? null, points: next.points ?? null })),
    hasImpact: invalidated.length > 0 || lostSchedules.length > 0,
  };
}

export { labelOf as _labelOf };
