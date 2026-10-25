import { generateGroupsThenKnockout, generateSingleElimination, validateFormat, BracketError } from './bracket.ts';
import type { BracketContext, BracketPlan, SeededPair } from './bracket.ts';
import { checkEligibility } from './eligibility.ts';
import { analyzeBracketChange, analyzeResultCorrection, applyPlanToState } from './impact.ts';
import type { ImpactReport } from './impact.ts';
import type { Command, ResultPayload } from './ops.ts';
import { categoryMatches, findInvalidResults, resolveCategory } from './resolve.ts';
import { detectScheduleIssues } from './schedule.ts';
import { decideWinner, validateScore } from './scoring.ts';
import type {
  Athlete,
  AuditEntry,
  Category,
  Court,
  EntityType,
  Id,
  Match,
  Pair,
  Registration,
  ResultRevision,
  ScoringRule,
  TournamentState,
  Tournament,
} from './types.ts';
import { normalizeSearch } from './util.ts';

export interface ApplyContext {
  now: string;
  deviceId: string;
  opId: string;
}

export interface ApplyResult {
  state: TournamentState;
  warnings: string[];
}

export class DomainError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const MIN_REASON_LENGTH = 10;

const fail = (code: string, message: string, details?: unknown): never => {
  throw new DomainError(code, message, details);
};

function clone(state: TournamentState): TournamentState {
  return structuredClone(state);
}

function audit(s: TournamentState, ctx: ApplyContext, e: { entityType: EntityType; entityId: Id; action: string; before?: unknown; after?: unknown; reason?: string }): void {
  const entry: AuditEntry = {
    id: `${ctx.opId}:${s.audit.length}`,
    tournamentId: s.tournament?.id ?? '',
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    before: e.before,
    after: e.after,
    reason: e.reason,
    deviceId: ctx.deviceId,
    at: ctx.now,
  };
  s.audit.push(entry);
}

const need = <T>(v: T | undefined | null, code: string, message: string): T => {
  if (v === undefined || v === null) return fail(code, message);
  return v;
};

const tid = (s: TournamentState): Id => need(s.tournament, 'NO_TOURNAMENT', 'Crie o torneio antes.').id;

const FROZEN_FIELDS: Array<keyof Category> = ['format', 'formatConfig', 'scoring', 'groupScoring', 'tiebreakers', 'woCredit', 'thirdPlaceMatch'];

function approvedCount(s: TournamentState, categoryId: Id): number {
  return Object.values(s.registrations).filter((r) => r.categoryId === categoryId && r.status === 'approved').length;
}

function renumberWaitlist(s: TournamentState, categoryId: Id): void {
  const list = Object.values(s.registrations)
    .filter((r) => r.categoryId === categoryId && r.status === 'waitlist')
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0) || a.id.localeCompare(b.id));
  list.forEach((r, i) => {
    r.waitlistPosition = i + 1;
  });
}

function pairAthletes(s: TournamentState, pairId: Id): Athlete[] {
  const p = need(s.pairs[pairId], 'PAIR_NOT_FOUND', 'Dupla não encontrada.');
  return [s.athletes[p.athleteAId], s.athletes[p.athleteBId]].filter((x): x is Athlete => !!x);
}

function pairSearchKey(s: TournamentState, p: Pair): string {
  const a = s.athletes[p.athleteAId];
  const b = s.athletes[p.athleteBId];
  return normalizeSearch([a?.fullName, b?.fullName, p.displayName].filter(Boolean).join(' '));
}

function ruleFor(category: Category, m: Match): ScoringRule {
  return m.phase === 'group' ? (category.groupScoring ?? category.scoring) : category.scoring;
}

function markInvalid(s: TournamentState, ctx: ApplyContext, matchIds: Id[], by: 'bracket_change' | 'correction'): void {
  for (const id of matchIds) {
    const revs = s.results[id];
    const last = revs?.[revs.length - 1];
    if (last && !last.invalidatedAt) {
      last.invalidatedAt = ctx.now;
      last.invalidatedBy = by;
      audit(s, ctx, { entityType: 'result', entityId: id, action: 'result.invalidated', before: { revision: last.revision, winnerPairId: last.winnerPairId }, reason: by });
    }
    const m = s.matches[id];
    if (m) {
      m.lifecycle = 'not_started';
      delete m.live;
      m.updatedAt = ctx.now;
    }
  }
}

/** Dupla com partida em andamento ou finalizada em alguma categoria (RF-05). */
export function pairHasStartedMatches(s: TournamentState, pairId: Id): boolean {
  const cats = new Set(Object.values(s.registrations).filter((r) => r.pairId === pairId).map((r) => r.categoryId));
  for (const cid of cats) {
    const res = resolveCategory(s, cid).matches;
    for (const m of categoryMatches(s, cid)) {
      const r = res[m.id];
      const mine = (r?.a.kind === 'pair' && r.a.pairId === pairId) || (r?.b.kind === 'pair' && r.b.pairId === pairId);
      if (mine && m.lifecycle !== 'not_started') return true;
    }
  }
  return false;
}

/** Sobreposição de quadra ou de dupla nunca é salva (regra 5); descanso curto vira aviso. */
function guardSchedule(before: TournamentState, after: TournamentState, touched: Id[], warnings: string[]): void {
  const known = new Set(detectScheduleIssues(before).map((i) => `${i.code}:${i.matchIds.join(',')}`));
  for (const issue of detectScheduleIssues(after)) {
    if (known.has(`${issue.code}:${issue.matchIds.join(',')}`) || !issue.matchIds.some((id) => touched.includes(id))) continue;
    if (issue.code === 'COURT_OVERLAP' || issue.code === 'PAIR_OVERLAP') fail('SCHEDULE_CONFLICT', issue.message, issue);
    warnings.push(issue.message);
  }
}

function buildPlan(s: TournamentState, category: Category, seed: number, now: string): BracketPlan {
  const regs = Object.values(s.registrations)
    .filter((r) => r.categoryId === category.id && r.status === 'approved')
    .sort((a, b) => a.id.localeCompare(b.id));
  const pairs: SeededPair[] = regs.map((r) => ({ pairId: r.pairId, seed: r.seed }));
  const ctx: BracketContext = { tournamentId: tid(s), categoryId: category.id, now };
  try {
    if (category.format === 'single_elimination') {
      return generateSingleElimination(ctx, { pairs, thirdPlace: category.thirdPlaceMatch, seed });
    }
    const cfg = category.formatConfig;
    return generateGroupsThenKnockout(ctx, {
      pairs,
      groups: cfg.groups ?? 0,
      advancePerGroup: cfg.advancePerGroup ?? 0,
      thirdPlace: category.thirdPlaceMatch,
      seed,
    });
  } catch (e) {
    if (e instanceof BracketError) return fail(e.code, e.message);
    throw e;
  }
}

export interface ImpactRequired {
  report: ImpactReport;
}

function requireConfirmation(report: ImpactReport, token: string | undefined): void {
  if (report.blocking) fail('IMPACT_BLOCKING', report.blockingReason ?? 'Alteração bloqueada.', report);
  if (report.hasImpact && token !== report.token) {
    fail('IMPACT_CONFIRMATION_REQUIRED', 'Esta alteração afeta resultados ou horários. Confirme para continuar.', report);
  }
}

/** Pré-visualização do impacto de gerar/regerar a chave, sem alterar o estado. */
export function previewBracket(state: TournamentState, categoryId: Id, seed: number, now: string): { plan: BracketPlan; report: ImpactReport } {
  const category = need(state.categories[categoryId], 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
  const plan = buildPlan(state, category, seed, now);
  return { plan, report: analyzeBracketChange(state, categoryId, plan, now) };
}

/** Pré-visualização do impacto de corrigir um resultado. */
export function previewResult(state: TournamentState, p: ResultPayload, now: string, deviceId = 'preview'): ImpactReport {
  const { revision } = buildRevision(state, p, { now, deviceId, opId: 'preview' });
  return analyzeResultCorrection(state, p.matchId, revision);
}

function buildRevision(s: TournamentState, p: ResultPayload, ctx: ApplyContext): { revision: ResultRevision; correction: boolean } {
  const match = need(s.matches[p.matchId], 'MATCH_NOT_FOUND', 'Partida não encontrada.');
  const category = need(s.categories[match.categoryId], 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
  const res = resolveCategory(s, match.categoryId).matches[match.id] as ReturnType<typeof resolveCategory>['matches'][string];
  if (res.autoBye) fail('MATCH_BYE', 'Esta partida não tem adversário e não recebe resultado.');
  if (res.a.kind !== 'pair' || res.b.kind !== 'pair') fail('MATCH_NOT_READY', 'As duplas desta partida ainda não estão definidas.');
  const a = (res.a as { pairId: Id }).pairId;
  const b = (res.b as { pairId: Id }).pairId;
  if ((p.expectedA && p.expectedA !== a) || (p.expectedB && p.expectedB !== b)) {
    fail('PARTICIPANTS_CHANGED', 'As duplas desta partida mudaram desde que você abriu o placar. Abra a partida de novo para conferir.');
  }

  const existing = s.results[match.id] ?? [];
  const last = existing[existing.length - 1];
  const correction = !!last && !last.invalidatedAt && last.kind !== 'pending';
  const reason = p.reason?.trim();
  if (correction && (!reason || reason.length < MIN_REASON_LENGTH)) {
    fail('REASON_REQUIRED', `Corrigir um resultado exige justificativa de pelo menos ${MIN_REASON_LENGTH} caracteres.`);
  }

  let winnerPairId: Id | undefined;
  let sets = p.sets;
  let points = p.points;
  if (p.kind === 'normal') {
    const rule = ruleFor(category, match);
    const entry = { sets: p.sets, points: p.points };
    const issues = validateScore(rule, entry);
    if (issues.length > 0) fail('SCORE_INVALID', (issues[0] as { message: string }).message, issues);
    const w = decideWinner(rule, entry);
    if ('error' in w) return fail('SCORE_INVALID', w.error);
    winnerPairId = w.winner === 'a' ? a : b;
  } else if (p.kind === 'walkover') {
    if (p.winnerPairId !== a && p.winnerPairId !== b) fail('WINNER_INVALID', 'Informe qual dupla venceu por W.O.');
    winnerPairId = p.winnerPairId;
    sets = undefined;
    points = undefined;
  } else {
    if (p.retiredPairId !== a && p.retiredPairId !== b) fail('RETIRED_INVALID', 'Informe qual dupla desistiu.');
    winnerPairId = p.retiredPairId === a ? b : a;
  }
  const revision: ResultRevision = {
    id: p.resultId,
    tournamentId: tid(s),
    matchId: match.id,
    revision: existing.length + 1,
    kind: p.kind,
    participants: [a, b],
    winnerPairId,
    sets,
    points,
    retiredPairId: p.kind === 'retired' ? p.retiredPairId : undefined,
    reason: reason || undefined,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
  };
  return { revision, correction };
}

/** Aplica um comando sobre o agregado. Pura: devolve um novo estado ou lança `DomainError`. */
export function apply(state: TournamentState, cmd: Command, ctx: ApplyContext): ApplyResult {
  const s = clone(state);
  const warnings: string[] = [];

  // Torneio encerrado é somente leitura até ser reaberto (RF-03); a anonimização (LGPD) continua permitida.
  if (s.tournament?.status === 'closed' && cmd.type !== 'tournament.save' && cmd.type !== 'athlete.anonymize') {
    fail('TOURNAMENT_CLOSED', 'O torneio está encerrado. Reabra-o, com justificativa, para alterar.');
  }

  switch (cmd.type) {
    case 'tournament.save': {
      const t = cmd.payload.tournament;
      const prev = s.tournament;
      if (prev && prev.id !== t.id) fail('TOURNAMENT_MISMATCH', 'Este armazenamento já guarda outro torneio.');
      const merged = { ...(prev ?? {}), ...t } as Tournament;
      if (!prev) {
        for (const k of ['name', 'organizationName', 'startDate', 'endDate', 'city', 'venue', 'slug', 'organizationId'] as const) {
          if (!merged[k] || String(merged[k]).trim() === '') fail('FIELD_REQUIRED', `Preencha o campo ${k}.`, { field: k });
        }
        merged.status ??= 'draft';
        merged.theme ??= { primary: '#FFB020', accent: '#FFB020' };
        merged.publish ??= {
          published: false,
          autoPublishOnSync: false,
          sections: { pairs: true, brackets: true, schedule: true, results: true, podium: true },
          showDisplayNames: true,
        };
        merged.defaults ??= { matchDurationMin: 40, restMin: 20 };
        merged.createdAt = ctx.now;
      }
      if (prev?.status === 'closed' && merged.status !== 'closed') {
        const why = cmd.payload.reason?.trim() ?? '';
        if (why.length < MIN_REASON_LENGTH) fail('REASON_REQUIRED', `Reabrir o torneio exige justificativa de pelo menos ${MIN_REASON_LENGTH} caracteres.`);
      }
      if (merged.endDate < merged.startDate) fail('DATE_RANGE', 'A data final não pode ser anterior à inicial.');
      if (merged.defaults.matchDurationMin < 1 || merged.defaults.restMin < 0) fail('DEFAULTS_INVALID', 'Duração e descanso precisam ser valores válidos.');
      merged.updatedAt = ctx.now;
      s.tournament = merged;
      audit(s, ctx, { entityType: 'tournament', entityId: merged.id, action: prev ? (prev.status !== merged.status ? `tournament.status.${merged.status}` : 'tournament.updated') : 'tournament.created', before: prev ?? undefined, after: t, reason: cmd.payload.reason?.trim() || undefined });
      break;
    }
    case 'court.save': {
      const id = tid(s);
      const c = cmd.payload.court;
      const prev = s.courts[c.id] as Court | undefined;
      const name = (c.name ?? prev?.name ?? '').trim();
      if (!name) fail('FIELD_REQUIRED', 'Dê um nome à quadra.', { field: 'name' });
      s.courts[c.id] = Object.assign({ order: Object.keys(s.courts).length + 1 }, prev, c, { name, tournamentId: id, updatedAt: ctx.now }) as Court;
      break;
    }
    case 'court.delete': {
      const used = Object.values(s.matches).some((m) => m.courtId === cmd.payload.courtId);
      if (used) fail('COURT_IN_USE', 'Há partidas agendadas nesta quadra. Reagende antes de remover.');
      delete s.courts[cmd.payload.courtId];
      break;
    }
    case 'category.save': {
      const id = tid(s);
      const c = cmd.payload.category;
      const prev = s.categories[c.id] as Category | undefined;
      if (prev?.lockedAt) {
        for (const f of FROZEN_FIELDS) {
          if (f in c && JSON.stringify(c[f]) !== JSON.stringify(prev[f])) {
            fail('CATEGORY_LOCKED', 'As regras ficam congeladas depois que a chave é gerada.', { field: f });
          }
        }
      }
      const merged = Object.assign({ waitlistEnabled: false, thirdPlaceMatch: false, formatConfig: {}, tiebreakers: ['head_to_head', 'set_diff', 'point_diff'], woCredit: 'none' }, prev, c, { tournamentId: id, updatedAt: ctx.now }) as Category;
      if (!merged.name?.trim()) fail('FIELD_REQUIRED', 'Dê um nome à categoria.', { field: 'name' });
      if (!merged.format || !merged.scoring) fail('FIELD_REQUIRED', 'Defina o formato e a regra de pontuação.');
      if (merged.capacity !== undefined && (!Number.isInteger(merged.capacity) || merged.capacity < 2)) fail('CAPACITY_INVALID', 'A capacidade precisa ser de pelo menos 2 duplas.');
      s.categories[merged.id] = merged;
      break;
    }
    case 'category.delete': {
      const cid = cmd.payload.categoryId;
      if (s.brackets[cid] || Object.values(s.registrations).some((r) => r.categoryId === cid && r.status !== 'canceled')) {
        fail('CATEGORY_IN_USE', 'Há inscrições ou chave nesta categoria. Cancele as inscrições antes de removê-la.');
      }
      delete s.categories[cid];
      break;
    }
    case 'athlete.save': {
      const id = tid(s);
      const a = cmd.payload.athlete;
      const prev = s.athletes[a.id];
      if (prev?.anonymizedAt) fail('ATHLETE_ANONYMIZED', 'Este atleta foi anonimizado e não pode ser editado.');
      const merged = { ...(prev ?? {}), ...a, tournamentId: id, updatedAt: ctx.now } as Athlete;
      merged.fullName = (merged.fullName ?? '').trim();
      if (!merged.fullName) fail('FIELD_REQUIRED', 'Informe o nome do atleta.', { field: 'fullName' });
      merged.searchKey = normalizeSearch(merged.fullName);
      s.athletes[merged.id] = merged;
      for (const p of Object.values(s.pairs)) {
        if (p.athleteAId === merged.id || p.athleteBId === merged.id) p.searchKey = pairSearchKey(s, p);
      }
      break;
    }
    case 'athlete.anonymize': {
      const a = need(s.athletes[cmd.payload.athleteId], 'ATHLETE_NOT_FOUND', 'Atleta não encontrado.');
      const before = { fullName: a.fullName };
      a.fullName = 'Atleta anonimizado';
      a.searchKey = normalizeSearch(a.fullName);
      delete a.phone;
      delete a.birthDate;
      delete a.city;
      a.anonymizedAt = ctx.now;
      a.updatedAt = ctx.now;
      for (const p of Object.values(s.pairs)) {
        if (p.athleteAId === a.id || p.athleteBId === a.id) {
          delete p.displayName;
          p.searchKey = pairSearchKey(s, p);
        }
      }
      audit(s, ctx, { entityType: 'athlete', entityId: a.id, action: 'athlete.anonymized', before: { redacted: Boolean(before.fullName) } });
      break;
    }
    case 'pair.save': {
      const id = tid(s);
      const p = cmd.payload.pair;
      const prev = s.pairs[p.id];
      const merged = { ...(prev ?? {}), ...p, tournamentId: id, updatedAt: ctx.now } as Pair;
      if (!merged.athleteAId || !merged.athleteBId) fail('FIELD_REQUIRED', 'Escolha os dois atletas da dupla.');
      if (merged.athleteAId === merged.athleteBId) fail('PAIR_SAME_ATHLETE', 'A dupla precisa ter dois atletas diferentes.');
      need(s.athletes[merged.athleteAId], 'ATHLETE_NOT_FOUND', 'Atleta não encontrado.');
      need(s.athletes[merged.athleteBId], 'ATHLETE_NOT_FOUND', 'Atleta não encontrado.');
      const key = [merged.athleteAId, merged.athleteBId].sort().join('|');
      const dup = Object.values(s.pairs).find((x) => x.id !== merged.id && [x.athleteAId, x.athleteBId].sort().join('|') === key);
      if (dup) fail('PAIR_DUPLICATE', 'Esta dupla já existe.', { pairId: dup.id });
      const swapped = !!prev && (prev.athleteAId !== merged.athleteAId || prev.athleteBId !== merged.athleteBId);
      if (swapped && pairHasStartedMatches(s, merged.id) && !cmd.payload.confirmed) {
        fail('PAIR_CHANGE_CONFIRMATION_REQUIRED', 'Esta dupla já tem partidas iniciadas. Trocar um atleta não altera os resultados já registrados; confirme para continuar.');
      }
      merged.searchKey = pairSearchKey(s, merged);
      s.pairs[merged.id] = merged;
      if (swapped) audit(s, ctx, { entityType: 'pair', entityId: merged.id, action: 'pair.athlete_changed', before: { athleteAId: prev!.athleteAId, athleteBId: prev!.athleteBId }, after: { athleteAId: merged.athleteAId, athleteBId: merged.athleteBId } });
      break;
    }
    case 'registration.create': {
      const p = cmd.payload;
      const category = need(s.categories[p.categoryId], 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
      need(s.pairs[p.pairId], 'PAIR_NOT_FOUND', 'Dupla não encontrada.');
      if (s.registrations[p.registrationId]) fail('REGISTRATION_EXISTS', 'Inscrição já existe.');
      const myAthletes = pairAthletes(s, p.pairId).map((a) => a.id);
      for (const r of Object.values(s.registrations)) {
        if (r.categoryId !== p.categoryId || r.status === 'canceled') continue;
        if (r.pairId === p.pairId) fail('REGISTRATION_DUPLICATE', 'Esta dupla já está inscrita nesta categoria.');
        const other = s.pairs[r.pairId];
        if (other && (myAthletes.includes(other.athleteAId) || myAthletes.includes(other.athleteBId))) {
          fail('ATHLETE_DUPLICATE', 'Um dos atletas já está inscrito nesta categoria em outra dupla.');
        }
      }
      let status: Registration['status'] = 'pending';
      let waitlistPosition: number | undefined;
      if (category.capacity !== undefined && approvedCount(s, category.id) >= category.capacity) {
        if (!category.waitlistEnabled) fail('CAPACITY_FULL', 'A categoria está lotada e não tem lista de espera.');
        status = 'waitlist';
        waitlistPosition = Object.values(s.registrations).filter((r) => r.categoryId === category.id && r.status === 'waitlist').length + 1;
      }
      s.registrations[p.registrationId] = {
        id: p.registrationId,
        tournamentId: tid(s),
        categoryId: p.categoryId,
        pairId: p.pairId,
        status,
        waitlistPosition,
        checkedInA: false,
        checkedInB: false,
        updatedAt: ctx.now,
      };
      for (const w of checkEligibility(pairAthletes(s, p.pairId), category, s.tournament?.startDate ?? ctx.now.slice(0, 10))) warnings.push(w.message);
      break;
    }
    case 'registration.setStatus': {
      const r = need(s.registrations[cmd.payload.registrationId], 'REGISTRATION_NOT_FOUND', 'Inscrição não encontrada.');
      const category = need(s.categories[r.categoryId], 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
      const to = cmd.payload.status;
      const from = r.status;
      if (from === to) break;
      if (to === 'approved' && category.capacity !== undefined && approvedCount(s, category.id) >= category.capacity) {
        fail('CAPACITY_FULL', 'A categoria já atingiu a capacidade.');
      }
      if (to === 'waitlist' && !category.waitlistEnabled) fail('WAITLIST_DISABLED', 'Esta categoria não tem lista de espera.');
      r.status = to;
      r.updatedAt = ctx.now;
      if (to === 'waitlist') {
        r.waitlistPosition = Object.values(s.registrations).filter((x) => x.categoryId === r.categoryId && x.status === 'waitlist' && x.id !== r.id).length + 1;
      } else {
        delete r.waitlistPosition;
      }
      if (from === 'approved' && to !== 'approved') {
        const next = Object.values(s.registrations)
          .filter((x) => x.categoryId === r.categoryId && x.status === 'waitlist')
          .sort((x, y) => (x.waitlistPosition ?? 0) - (y.waitlistPosition ?? 0))[0];
        if (next) {
          next.status = 'pending';
          delete next.waitlistPosition;
          next.updatedAt = ctx.now;
          warnings.push('A primeira dupla da lista de espera passou para "pendente".');
        }
        if (category.lockedAt) warnings.push('A chave já foi gerada. Gere-a novamente para refletir esta mudança.');
      }
      renumberWaitlist(s, r.categoryId);
      audit(s, ctx, { entityType: 'registration', entityId: r.id, action: 'registration.status', before: { status: from }, after: { status: to } });
      break;
    }
    case 'registration.checkIn': {
      const r = need(s.registrations[cmd.payload.registrationId], 'REGISTRATION_NOT_FOUND', 'Inscrição não encontrada.');
      if (cmd.payload.side === 'a') r.checkedInA = cmd.payload.value;
      else r.checkedInB = cmd.payload.value;
      r.updatedAt = ctx.now;
      break;
    }
    case 'registration.setSeed': {
      const r = need(s.registrations[cmd.payload.registrationId], 'REGISTRATION_NOT_FOUND', 'Inscrição não encontrada.');
      const seed = cmd.payload.seed;
      if (seed === null) delete r.seed;
      else {
        if (!Number.isInteger(seed) || seed < 1) fail('SEED_INVALID', 'A semente precisa ser um número inteiro positivo.');
        const clash = Object.values(s.registrations).find((x) => x.id !== r.id && x.categoryId === r.categoryId && x.status !== 'canceled' && x.seed === seed);
        if (clash) fail('SEED_DUPLICATE', `A semente ${seed} já foi atribuída a outra dupla.`);
        r.seed = seed;
      }
      r.updatedAt = ctx.now;
      break;
    }
    case 'bracket.generate': {
      const { categoryId, seed, confirmToken } = cmd.payload;
      const category = need(s.categories[categoryId], 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
      const fv = category.format === 'groups_then_knockout' ? validateFormat(category.format, approvedCount(s, categoryId), category.formatConfig) : null;
      if (fv && !fv.ok) fail('FORMAT_INVALID', fv.errors.join(' '), fv);
      const plan = buildPlan(s, category, seed, ctx.now);
      const exists = categoryMatches(s, categoryId).length > 0;
      const report = analyzeBracketChange(s, categoryId, plan, ctx.now);
      if (exists) requireConfirmation(report, confirmToken);
      const next = applyPlanToState(s, categoryId, plan, ctx.now);
      Object.assign(s, next);
      markInvalid(s, ctx, report.invalidated.map((i) => i.matchId), 'bracket_change');
      s.categories[categoryId] = { ...category, lockedAt: category.lockedAt ?? ctx.now, updatedAt: ctx.now };
      audit(s, ctx, { entityType: 'bracket', entityId: categoryId, action: exists ? 'bracket.regenerated' : 'bracket.generated', after: { seed, size: plan.meta.size, byes: plan.meta.byes }, reason: report.lines.join(' ') || undefined });
      if (plan.meta.byes > 0) warnings.push(`${plan.meta.byes} vaga(s) de bye: as melhores sementes avançam sem jogar.`);
      break;
    }
    case 'bracket.swap': {
      const { categoryId, a, b, confirmToken } = cmd.payload;
      need(s.categories[categoryId], 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
      const meta = need(s.brackets[categoryId], 'BRACKET_NOT_FOUND', 'Gere a chave antes de trocar posições.');
      const ma = need(s.matches[a.matchId], 'MATCH_NOT_FOUND', 'Partida não encontrada.');
      const mb = need(s.matches[b.matchId], 'MATCH_NOT_FOUND', 'Partida não encontrada.');
      if (ma.categoryId !== categoryId || mb.categoryId !== categoryId) fail('SWAP_INVALID', 'As duas posições precisam ser da mesma categoria.');
      if (ma.phase !== 'knockout' || mb.phase !== 'knockout') fail('SWAP_INVALID', 'Só é possível trocar posições do mata-mata.');
      if (ma.id === mb.id && a.side === b.side) fail('SWAP_INVALID', 'Escolha duas posições diferentes.');
      const slotOf = (m: Match, side: 'a' | 'b') => (side === 'a' ? m.slotA : m.slotB);
      const sa = slotOf(ma, a.side);
      const sb = slotOf(mb, b.side);
      if (sa.kind !== 'pair' || sb.kind !== 'pair') fail('SWAP_INVALID', 'Só é possível trocar posições que já têm dupla.');
      const copies: Record<Id, Match> = {};
      for (const m of categoryMatches(s, categoryId)) copies[m.id] = { ...m };
      const put = (m: Match, side: 'a' | 'b', slot: Match['slotA']) => {
        const c = copies[m.id] as Match;
        if (side === 'a') c.slotA = slot;
        else c.slotB = slot;
      };
      put(ma, a.side, sb);
      put(mb, b.side, sa);
      const plan = { matches: Object.values(copies), meta } as unknown as BracketPlan;
      const report = analyzeBracketChange(s, categoryId, plan, ctx.now);
      requireConfirmation(report, confirmToken);
      Object.assign(s, applyPlanToState(s, categoryId, plan, ctx.now));
      markInvalid(s, ctx, report.invalidated.map((i) => i.matchId), 'bracket_change');
      audit(s, ctx, {
        entityType: 'bracket',
        entityId: categoryId,
        action: 'bracket.swapped',
        before: { a: sa, b: sb },
        after: { a: sb, b: sa },
        reason: report.lines.join(' ') || undefined,
      });
      break;
    }
    case 'match.schedule': {
      const m = need(s.matches[cmd.payload.matchId], 'MATCH_NOT_FOUND', 'Partida não encontrada.');
      if (m.lifecycle === 'finished') fail('MATCH_FINISHED', 'A partida já terminou.');
      const { courtId, scheduledAt } = cmd.payload;
      if (courtId) need(s.courts[courtId], 'COURT_NOT_FOUND', 'Quadra não encontrada.');
      if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) fail('DATE_INVALID', 'Data e hora inválidas.');
      if (courtId) m.courtId = courtId;
      else delete m.courtId;
      if (scheduledAt) m.scheduledAt = scheduledAt;
      else delete m.scheduledAt;
      m.updatedAt = ctx.now;
      guardSchedule(state, s, [m.id], warnings);
      break;
    }
    case 'schedule.apply': {
      for (const a of cmd.payload.assignments) {
        const m = need(s.matches[a.matchId], 'MATCH_NOT_FOUND', 'Partida não encontrada.');
        need(s.courts[a.courtId], 'COURT_NOT_FOUND', 'Quadra não encontrada.');
        m.courtId = a.courtId;
        m.scheduledAt = a.scheduledAt;
        m.updatedAt = ctx.now;
      }
      guardSchedule(state, s, cmd.payload.assignments.map((a) => a.matchId), warnings);
      break;
    }
    case 'match.start': {
      const m = need(s.matches[cmd.payload.matchId], 'MATCH_NOT_FOUND', 'Partida não encontrada.');
      if (m.lifecycle === 'finished') fail('MATCH_FINISHED', 'A partida já terminou.');
      const res = resolveCategory(s, m.categoryId).matches[m.id];
      if (!res || res.a.kind !== 'pair' || res.b.kind !== 'pair' || res.autoBye) fail('MATCH_NOT_READY', 'As duplas desta partida ainda não estão definidas.');
      m.lifecycle = 'in_progress';
      m.live ??= { a: 0, b: 0, updatedAt: ctx.now };
      m.updatedAt = ctx.now;
      break;
    }
    case 'match.live_score': {
      const m = need(s.matches[cmd.payload.matchId], 'MATCH_NOT_FOUND', 'Partida não encontrada.');
      if (m.lifecycle === 'finished') fail('MATCH_FINISHED', 'A partida já terminou.');
      const { a, b } = cmd.payload;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) fail('SCORE_INVALID', 'O placar ao vivo precisa ter números inteiros não negativos.');
      m.lifecycle = 'in_progress';
      m.live = { a, b, updatedAt: ctx.now };
      m.updatedAt = ctx.now;
      break;
    }
    case 'result.record': {
      const p = cmd.payload;
      const { revision, correction } = buildRevision(s, p, ctx);
      const prevRevs = s.results[p.matchId] ?? [];
      const last = prevRevs[prevRevs.length - 1];
      if (correction) {
        const report = analyzeResultCorrection(s, p.matchId, revision);
        if (report.hasImpact && p.confirmToken !== report.token) {
          fail('IMPACT_CONFIRMATION_REQUIRED', 'Esta correção muda as duplas de partidas seguintes. Confirme para continuar.', report);
        }
      }
      if (last && last.id === revision.id) fail('RESULT_EXISTS', 'Este resultado já foi registrado.');
      (s.results[p.matchId] ??= []).push(revision);
      const m = s.matches[p.matchId] as Match;
      m.lifecycle = 'finished';
      delete m.live;
      m.updatedAt = ctx.now;
      const stale = findInvalidResults(s, m.categoryId);
      markInvalid(s, ctx, stale, 'correction');
      audit(s, ctx, {
        entityType: 'result',
        entityId: p.matchId,
        action: correction ? 'result.corrected' : 'result.recorded',
        before: last ? { revision: last.revision, winnerPairId: last.winnerPairId, sets: last.sets, points: last.points } : undefined,
        after: { revision: revision.revision, winnerPairId: revision.winnerPairId, sets: revision.sets, points: revision.points, kind: revision.kind },
        reason: revision.reason,
      });
      break;
    }
    case 'tie.resolve': {
      const t = cmd.payload.tie;
      const category = need(s.categories[t.categoryId], 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
      const res = resolveCategory(s, category.id);
      const g = res.groups[t.groupId];
      if (!g) fail('GROUP_NOT_FOUND', 'Grupo não encontrado.');
      const open = g!.unresolvedTies.find((x) => x.length === t.orderedPairIds.length && x.every((id) => t.orderedPairIds.includes(id)));
      if (!open) fail('TIE_NOT_OPEN', 'Não há empate em aberto com essas duplas.');
      if (!t.reason?.trim()) fail('REASON_REQUIRED', 'Registre como o empate foi decidido (ex.: sorteio).');
      s.ties[t.id] = { ...t, reason: t.reason.trim(), resolvedAt: ctx.now };
      audit(s, ctx, { entityType: 'tie', entityId: t.id, action: 'tie.resolved', after: { order: t.orderedPairIds }, reason: t.reason });
      break;
    }
  }
  return { state: s, warnings };
}
