// Montagem dos torneios fictícios. Tudo passa pelo `apply` do domínio (as mesmas regras do app):
// cada comando vira uma operação de sync idempotente, enviada depois pela API real (ver run.ts).
// Determinístico: os mesmos parâmetros geram sempre as mesmas operações.
import { apply, categoryMatches, commandTarget, emptyState, mulberry32, proposeSchedule, resolveCategory, validateScore } from '@playtorneios/domain';
import type { Command, Id, Match, ResultPayload, Rng, ScoringRule, SetScore, TournamentState } from '@playtorneios/domain';
import { SCHEMA_VERSION } from '@playtorneios/sync';
import type { Operation } from '@playtorneios/sync';
import { athleteFactory } from './names.ts';

export interface SeedPlan {
  tournamentId: Id;
  /** Nome para exibir no terminal. */
  title: string;
  slug: string;
  operations: Operation[];
  /** Estado final calculado localmente (usado nos testes e no resumo). */
  finalState: TournamentState;
  /** Torneios com página pública devem ser publicados ao final. */
  publish: boolean;
}

export interface SeedOptions {
  /** Data de referência (AAAA-MM-DD). Os torneios são datados em relação a ela. */
  today: string;
  /** Inclui o torneio grande, para testes de carga/desempenho. */
  carga?: boolean;
  organizationId: string;
  organizationName: string;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** 12:00 UTC = 09:00 em Brasília. */
const at = (date: string, hour = 12): string => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;

// ---------------------------------------------------------------- gravador de operações

class Recorder {
  state: TournamentState = emptyState();
  ops: Operation[] = [];
  readonly strength = new Map<Id, number>();
  readonly deviceId = 'seed-device';
  readonly tid: Id;
  private readonly startMs: number;
  constructor(tid: Id, startMs: number) {
    this.tid = tid;
    this.startMs = startMs;
  }

  do(input: Command): string[] {
    const cmd = JSON.parse(JSON.stringify(input)) as Command; // mesmo formato que o servidor recebe
    const n = this.ops.length + 1;
    const opId = `${this.tid}-op-${String(n).padStart(5, '0')}`;
    const now = new Date(this.startMs + n * 1000).toISOString();
    const result = apply(this.state, cmd, { now, deviceId: this.deviceId, opId });
    const target = commandTarget(cmd);
    this.state = result.state;
    this.ops.push({
      opId,
      deviceId: this.deviceId,
      seq: n,
      type: cmd.type,
      entityType: target.entityType,
      entityId: target.entityId,
      tournamentId: this.tid,
      payload: cmd.payload,
      clientCreatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    });
    return result.warnings;
  }
}

// ---------------------------------------------------------------- placares válidos

function setWinnerScore(points: number, winBy: 1 | 2, cap: number | undefined, rng: Rng): { w: number; l: number } {
  const candidates: Array<{ w: number; l: number }> = [];
  const low = Math.max(0, points - 13);
  const normalLoser = winBy === 2 ? Math.min(points - 2, low + Math.floor(rng() * (points - 2 - low + 1))) : low + Math.floor(rng() * (points - 1 - low + 1));
  candidates.push({ w: points, l: normalLoser });
  if (winBy === 2 && rng() < 0.25) {
    const k = 1 + Math.floor(rng() * 2);
    if (cap === undefined || points + k <= cap) candidates.unshift({ w: points + k, l: points + k - 2 });
  }
  return candidates[0] as { w: number; l: number };
}

/** Placar coerente com a regra, em que o lado `winner` vence. */
function genScore(rule: ScoringRule, winner: 'a' | 'b', rng: Rng): { sets?: SetScore[]; points?: { a: number; b: number } } {
  const orient = (w: number, l: number, side: 'a' | 'b'): SetScore => (side === 'a' ? { a: w, b: l } : { a: l, b: w });
  let out: { sets?: SetScore[]; points?: { a: number; b: number } };
  if (rule.model === 'target') {
    const { w, l } = setWinnerScore(rule.targetPoints, rule.winBy, rule.cap, rng);
    out = { points: orient(w, l, winner) };
  } else {
    const need = (rule.bestOf + 1) / 2;
    const loserSets = need === 1 ? 0 : Math.floor(rng() * need);
    const order: Array<'w' | 'l'> = [];
    const pool: Array<'w' | 'l'> = [...Array(loserSets).fill('l'), ...Array(need - 1).fill('w')];
    while (pool.length) order.push(pool.splice(Math.floor(rng() * pool.length), 1)[0] as 'w' | 'l');
    order.push('w');
    const sets = order.map((who, i) => {
      const deciding = i === rule.bestOf - 1 && rule.bestOf > 1;
      const target = deciding ? (rule.decidingSetPoints ?? rule.setPoints) : rule.setPoints;
      const { w, l } = setWinnerScore(target, rule.winBy, rule.cap, rng);
      return orient(w, l, who === 'w' ? winner : winner === 'a' ? 'b' : 'a');
    });
    out = { sets };
  }
  const issues = validateScore(rule, out);
  if (issues.length) throw new Error(`Placar gerado é inválido: ${JSON.stringify(out)} (${issues[0]?.message})`);
  return out;
}

// ---------------------------------------------------------------- blocos reutilizáveis

type Kind = 'male' | 'female' | 'mixed';

interface EnrollOptions {
  categoryId: Id;
  prefix: string;
  kind: Kind;
  approved: number;
  pending?: number;
  canceled?: number;
  /** Inscrições além da capacidade (vão para a lista de espera; exige capacidade + lista de espera). */
  over?: number;
  seeds?: number;
  checkIn?: 'all' | 'most' | 'none';
}

function enroll(rec: Recorder, f: ReturnType<typeof athleteFactory>, o: EnrollOptions): { pairIds: Id[]; registrationIds: Id[] } {
  const pairIds: Id[] = [];
  const registrationIds: Id[] = [];
  const total = o.approved + (o.pending ?? 0) + (o.canceled ?? 0) + (o.over ?? 0);
  for (let i = 1; i <= total; i++) {
    const key = `${o.prefix}-${String(i).padStart(2, '0')}`;
    const a = f.next(o.kind === 'female' ? 'female' : 'male');
    const b = f.next(o.kind === 'male' ? 'male' : 'female');
    rec.do({ type: 'athlete.save', payload: { athlete: { id: `${key}-a`, ...a } } });
    rec.do({ type: 'athlete.save', payload: { athlete: { id: `${key}-b`, ...b } } });
    rec.do({ type: 'pair.save', payload: { pair: { id: key, athleteAId: `${key}-a`, athleteBId: `${key}-b` } } });
    rec.do({ type: 'registration.create', payload: { registrationId: `r-${key}`, categoryId: o.categoryId, pairId: key } });
    rec.strength.set(key, 0.25 + f.rng() * 0.75);
    if (i <= o.approved) {
      rec.do({ type: 'registration.setStatus', payload: { registrationId: `r-${key}`, status: 'approved' } });
      pairIds.push(key);
      registrationIds.push(`r-${key}`);
    } else if (i <= o.approved + (o.pending ?? 0)) {
      // permanece pendente
    } else if (i <= o.approved + (o.pending ?? 0) + (o.canceled ?? 0)) {
      rec.do({ type: 'registration.setStatus', payload: { registrationId: `r-${key}`, status: 'canceled' } });
    } // o restante já entrou na lista de espera automaticamente
  }
  // Cabeças de chave: as duplas mais fortes.
  const byStrength = [...pairIds].sort((x, y) => (rec.strength.get(y) ?? 0) - (rec.strength.get(x) ?? 0));
  byStrength.slice(0, o.seeds ?? 0).forEach((p, idx) => rec.do({ type: 'registration.setSeed', payload: { registrationId: `r-${p}`, seed: idx + 1 } }));
  // Check-in.
  const mode = o.checkIn ?? 'most';
  if (mode !== 'none') {
    for (const [i, rid] of registrationIds.entries()) {
      rec.do({ type: 'registration.checkIn', payload: { registrationId: rid, side: 'a', value: true } });
      if (mode === 'all' || i % 5 !== 4) rec.do({ type: 'registration.checkIn', payload: { registrationId: rid, side: 'b', value: true } });
    }
  }
  return { pairIds, registrationIds };
}

function generate(rec: Recorder, categoryId: Id, seed: number): void {
  rec.do({ type: 'bracket.generate', payload: { categoryId, seed } });
}

function scheduleAll(rec: Recorder, startAt: string, courtIds: Id[], categoryIds?: Id[]): void {
  const assignments = proposeSchedule(rec.state, { startAt, courtIds, categoryIds });
  for (let i = 0; i < assignments.length; i += 200) rec.do({ type: 'schedule.apply', payload: { assignments: assignments.slice(i, i + 200) } });
}

interface Ready {
  match: Match;
  a: Id;
  b: Id;
}

function readyMatches(state: TournamentState, categoryId: Id, skip?: (m: Match) => boolean): Ready[] {
  const res = resolveCategory(state, categoryId);
  const out: Ready[] = [];
  for (const m of categoryMatches(state, categoryId)) {
    const r = res.matches[m.id];
    if (!r || r.autoBye || r.a.kind !== 'pair' || r.b.kind !== 'pair' || r.result || m.lifecycle === 'finished' || skip?.(m)) continue;
    out.push({ match: m, a: r.a.pairId, b: r.b.pairId });
  }
  return out;
}

function ruleOf(state: TournamentState, m: Match): ScoringRule {
  const c = state.categories[m.categoryId];
  if (!c) throw new Error('categoria inexistente');
  return m.phase === 'group' ? (c.groupScoring ?? c.scoring) : c.scoring;
}

/** Lança resultado normal; o vencedor é sorteado pela força relativa das duplas (ou forçado). */
function recordNormal(rec: Recorder, rng: Rng, r: Ready, forcedWinner?: Id, forcedScore?: { w: number; l: number }): void {
  const sa = rec.strength.get(r.a) ?? 0.5;
  const sb = rec.strength.get(r.b) ?? 0.5;
  const winnerId = forcedWinner ?? (rng() < sa / (sa + sb) ? r.a : r.b);
  const side = winnerId === r.a ? 'a' : 'b';
  const rule = ruleOf(rec.state, r.match);
  let score = genScore(rule, side, rng);
  if (forcedScore && rule.model === 'target') score = { points: side === 'a' ? { a: forcedScore.w, b: forcedScore.l } : { a: forcedScore.l, b: forcedScore.w } };
  const payload: ResultPayload = { resultId: `res-${r.match.id}-1`, matchId: r.match.id, kind: 'normal', ...score, expectedA: r.a, expectedB: r.b };
  rec.do({ type: 'result.record', payload });
}

interface PlayOptions {
  rng: Rng;
  /** Para de jogar quando atingir esta quantidade de partidas. */
  limit?: number;
  /** Só joga mata-mata até esta rodada (a final fica em aberto, por exemplo). */
  maxKnockoutRound?: number;
  skip?: (m: Match) => boolean;
  /** Ganha a vez antes do lançamento normal (W.O., desistência, correção...). Retorne true se tratou a partida. */
  special?: (n: number, r: Ready) => boolean;
}

function play(rec: Recorder, categoryId: Id, o: PlayOptions): number {
  let n = 0;
  const skip = (m: Match): boolean => (o.skip?.(m) ?? false) || (m.phase === 'knockout' && o.maxKnockoutRound !== undefined && m.round > o.maxKnockoutRound);
  for (;;) {
    if (o.limit !== undefined && n >= o.limit) break;
    const next = readyMatches(rec.state, categoryId, skip)[0];
    if (!next) break;
    if (!o.special?.(n, next)) recordNormal(rec, o.rng, next);
    n++;
  }
  return n;
}

function lastKnockoutRound(state: TournamentState, categoryId: Id): number {
  return Math.max(0, ...categoryMatches(state, categoryId).filter((m) => m.phase === 'knockout').map((m) => m.round));
}

function setCourts(rec: Recorder, names: string[], location: string): Id[] {
  return names.map((name, i) => {
    const id = `${rec.tid}-q${i + 1}`;
    rec.do({ type: 'court.save', payload: { court: { id, name, location, order: i } } });
    return id;
  });
}

const FULL_PUBLISH = { published: true, autoPublishOnSync: true, sections: { pairs: true, brackets: true, schedule: true, results: true, podium: true }, showDisplayNames: true };

const SETS_18 = { model: 'sets', bestOf: 3, setPoints: 18, decidingSetPoints: 15, winBy: 2 } as const;
const TARGET_18 = { model: 'target', targetPoints: 18, winBy: 2, cap: 21 } as const;
const TIEBREAKERS = ['wins', 'head_to_head', 'set_diff', 'point_diff', 'points_for', 'manual_draw'] as const;

function finish(rec: Recorder, title: string, slug: string, publish: boolean): SeedPlan {
  return { tournamentId: rec.tid, title, slug, operations: rec.ops, finalState: rec.state, publish };
}

// ---------------------------------------------------------------- torneios

/** 1) Rascunho: só o básico, sem duplas. Bom para testar o fluxo de configuração. */
function rascunho(opt: SeedOptions): SeedPlan {
  const rec = new Recorder('seed-rascunho', Date.parse(at(opt.today)) - 3 * DAY);
  rec.do({
    type: 'tournament.save',
    payload: {
      tournament: {
        id: rec.tid,
        organizationId: opt.organizationId,
        organizationName: opt.organizationName,
        name: 'Torneio de Verão (rascunho de teste)',
        startDate: addDays(opt.today, 30),
        endDate: addDays(opt.today, 31),
        city: 'Natal',
        venue: 'Praia de Ponta Negra',
        description: 'Dados fictícios de teste. Torneio ainda em configuração.',
        slug: 'verao-rascunho-teste',
        status: 'draft',
      },
    },
  });
  setCourts(rec, ['Quadra A'], 'Arena Ponta Negra');
  rec.do({
    type: 'category.save',
    payload: {
      category: { id: 'cat-open', name: 'Dupla Open', gender: 'male', level: 'open', format: 'single_elimination', formatConfig: {}, scoring: SETS_18, tiebreakers: [...TIEBREAKERS], woCredit: 'none', waitlistEnabled: false, thirdPlaceMatch: false },
    },
  });
  return finish(rec, 'Rascunho', 'verao-rascunho-teste', false);
}

/** 2) Torneio em andamento: três categorias em estágios diferentes. É o principal para testar a interface. */
function copa(opt: SeedOptions): SeedPlan {
  const tid = 'seed-copa';
  const rec = new Recorder(tid, Date.parse(at(opt.today)) - 2 * DAY);
  const f = athleteFactory(1001);
  const rng = mulberry32(2001);
  const start = addDays(opt.today, -1);

  rec.do({
    type: 'tournament.save',
    payload: {
      tournament: {
        id: tid,
        organizationId: opt.organizationId,
        organizationName: opt.organizationName,
        name: 'Copa Praia Grande de Futevôlei (teste)',
        startDate: start,
        endDate: addDays(opt.today, 1),
        city: 'Praia Grande',
        venue: 'Arena Boqueirão',
        description: 'Dados fictícios de teste: três categorias em estágios diferentes (grupos, empate em aberto, lista de espera).',
        slug: 'copa-praia-grande-teste',
        status: 'open',
        theme: { primary: '#FFB020', accent: '#22D3EE' },
        publish: FULL_PUBLISH,
        defaults: { matchDurationMin: 35, restMin: 20 },
      },
    },
  });
  const courts = setCourts(rec, ['Quadra Central', 'Quadra 2', 'Quadra 3'], 'Arena Boqueirão');

  // --- Masculina Open: 12 duplas, 3 grupos de 4, passam 2 → quartas com 2 byes.
  rec.do({
    type: 'category.save',
    payload: {
      category: {
        id: 'cat-mas', name: 'Masculina Open', gender: 'male', level: 'open',
        format: 'groups_then_knockout', formatConfig: { groups: 3, advancePerGroup: 2 },
        scoring: SETS_18, groupScoring: TARGET_18, tiebreakers: [...TIEBREAKERS],
        woCredit: { winnerPoints: 18, loserPoints: 0 }, capacity: 16, waitlistEnabled: true, thirdPlaceMatch: true,
      },
    },
  });
  // --- Feminina Intermediária: 6 duplas, 2 grupos de 3, passam 2.
  rec.do({
    type: 'category.save',
    payload: {
      category: {
        id: 'cat-fem', name: 'Feminina Intermediária', gender: 'female', level: 'intermediate',
        format: 'groups_then_knockout', formatConfig: { groups: 2, advancePerGroup: 2 },
        scoring: SETS_18, groupScoring: TARGET_18, tiebreakers: ['wins', 'head_to_head', 'point_diff', 'manual_draw'],
        woCredit: 'none', waitlistEnabled: false, thirdPlaceMatch: true,
      },
    },
  });
  // --- Mista Iniciante: eliminação simples, 8 vagas, lista de espera.
  rec.do({
    type: 'category.save',
    payload: {
      category: {
        id: 'cat-mix', name: 'Mista Iniciante', gender: 'mixed', level: 'beginner',
        format: 'single_elimination', formatConfig: {},
        scoring: { model: 'target', targetPoints: 15, winBy: 2, cap: 18 }, tiebreakers: [...TIEBREAKERS],
        woCredit: 'none', capacity: 8, waitlistEnabled: true, thirdPlaceMatch: false,
      },
    },
  });

  enroll(rec, f, { categoryId: 'cat-mas', prefix: 'mas', kind: 'male', approved: 12, pending: 1, canceled: 1, seeds: 3, checkIn: 'most' });
  enroll(rec, f, { categoryId: 'cat-fem', prefix: 'fem', kind: 'female', approved: 6, pending: 1, seeds: 2, checkIn: 'all' });
  enroll(rec, f, { categoryId: 'cat-mix', prefix: 'mix', kind: 'mixed', approved: 8, over: 2, canceled: 1, checkIn: 'most' });

  generate(rec, 'cat-mas', 101);
  generate(rec, 'cat-fem', 102);
  generate(rec, 'cat-mix', 103);
  scheduleAll(rec, at(start, 12), courts);

  // Masculina: grupos completos (com W.O., desistência e uma correção), mata-mata até as semifinais; final ao vivo.
  play(rec, 'cat-mas', {
    rng,
    maxKnockoutRound: lastKnockoutRound(rec.state, 'cat-mas') - 1,
    special: (n, r) => {
      if (n === 0) {
        rec.do({ type: 'result.record', payload: { resultId: `res-${r.match.id}-1`, matchId: r.match.id, kind: 'walkover', winnerPairId: r.a, reason: 'Dupla adversária não compareceu.', expectedA: r.a, expectedB: r.b } });
        return true;
      }
      if (n === 1) {
        rec.do({ type: 'result.record', payload: { resultId: `res-${r.match.id}-1`, matchId: r.match.id, kind: 'retired', retiredPairId: r.b, points: { a: 11, b: 7 }, reason: 'Lesão no tornozelo.', expectedA: r.a, expectedB: r.b } });
        return true;
      }
      if (n === 2) {
        recordNormal(rec, rng, r, r.a);
        // Correção com justificativa: o placar tinha sido lançado invertido.
        rec.do({ type: 'result.record', payload: { resultId: `res-${r.match.id}-2`, matchId: r.match.id, kind: 'normal', ...genScore(ruleOf(rec.state, r.match), 'b', rng), reason: 'Placar lançado invertido por engano na súmula.', expectedA: r.a, expectedB: r.b } });
        return true;
      }
      return false;
    },
  });
  const finalRound = lastKnockoutRound(rec.state, 'cat-mas');
  const live = readyMatches(rec.state, 'cat-mas').find((r) => r.match.round === finalRound);
  if (live) {
    rec.do({ type: 'match.start', payload: { matchId: live.match.id } });
    rec.do({ type: 'match.live_score', payload: { matchId: live.match.id, a: 9, b: 7 } });
  }

  // Feminina: grupo A normal; grupo B com empate circular (todas vencem 1 e perdem 1, mesmo saldo) → desempate manual em aberto.
  const groupB = rec.state.brackets['cat-fem']?.groups?.[1];
  if (!groupB) throw new Error('grupo B não encontrado');
  const [x, y, z] = groupB.pairIds as [Id, Id, Id];
  const circle: Array<[Id, Id]> = [[x, y], [y, z], [z, x]];
  for (const [winner, loser] of circle) {
    const ready = readyMatches(rec.state, 'cat-fem').find((r) => r.match.groupId === groupB.id && [r.a, r.b].includes(winner) && [r.a, r.b].includes(loser));
    if (!ready) throw new Error('partida do grupo B não encontrada');
    recordNormal(rec, rng, ready, winner, { w: 18, l: 10 });
  }
  play(rec, 'cat-fem', { rng, skip: (m) => m.groupId === groupB.id });

  // Mista: duas partidas jogadas, uma em andamento, as demais por jogar.
  const mixPlayed = play(rec, 'cat-mix', { rng, limit: 2 });
  const inProgress = readyMatches(rec.state, 'cat-mix')[0];
  if (inProgress && mixPlayed === 2) {
    rec.do({ type: 'match.start', payload: { matchId: inProgress.match.id } });
    rec.do({ type: 'match.live_score', payload: { matchId: inProgress.match.id, a: 6, b: 4 } });
  }
  return finish(rec, 'Copa em andamento', 'copa-praia-grande-teste', true);
}

/** 3) Torneio encerrado: tudo jogado, pódio completo e página pública. */
function encerrado(opt: SeedOptions): SeedPlan {
  const tid = 'seed-encerrado';
  const rec = new Recorder(tid, Date.parse(at(opt.today)) - 45 * DAY);
  const f = athleteFactory(1002);
  const rng = mulberry32(2002);
  const start = addDays(opt.today, -40);
  const tournament = {
    id: tid,
    organizationId: opt.organizationId,
    organizationName: opt.organizationName,
    name: 'Open de Inverno (encerrado, teste)',
    startDate: start,
    endDate: addDays(start, 1),
    city: 'Florianópolis',
    venue: 'Praia da Joaquina',
    description: 'Dados fictícios de teste: torneio concluído com pódio, resultados e agenda.',
    slug: 'open-inverno-teste',
    theme: { primary: '#22D3EE', accent: '#FFB020' },
    publish: FULL_PUBLISH,
    defaults: { matchDurationMin: 30, restMin: 15 },
  };
  rec.do({ type: 'tournament.save', payload: { tournament: { ...tournament, status: 'open' } } });
  const courts = setCourts(rec, ['Quadra 1', 'Quadra 2'], 'Joaquina');
  rec.do({
    type: 'category.save',
    payload: {
      category: { id: 'cat-mas', name: 'Masculina Open', gender: 'male', level: 'open', format: 'single_elimination', formatConfig: {}, scoring: SETS_18, tiebreakers: [...TIEBREAKERS], woCredit: 'none', waitlistEnabled: false, thirdPlaceMatch: true },
    },
  });
  rec.do({
    type: 'category.save',
    payload: {
      category: { id: 'cat-fem', name: 'Feminina Open', gender: 'female', level: 'open', format: 'groups_then_knockout', formatConfig: { groups: 2, advancePerGroup: 2 }, scoring: SETS_18, groupScoring: TARGET_18, tiebreakers: [...TIEBREAKERS], woCredit: 'none', waitlistEnabled: false, thirdPlaceMatch: true },
    },
  });
  enroll(rec, f, { categoryId: 'cat-mas', prefix: 'mas', kind: 'male', approved: 8, seeds: 2, checkIn: 'all' });
  enroll(rec, f, { categoryId: 'cat-fem', prefix: 'fem', kind: 'female', approved: 6, seeds: 2, checkIn: 'all' });
  generate(rec, 'cat-mas', 201);
  generate(rec, 'cat-fem', 202);
  scheduleAll(rec, at(start, 12), courts);
  play(rec, 'cat-mas', { rng });
  play(rec, 'cat-fem', { rng });
  rec.do({ type: 'tournament.save', payload: { tournament: { id: tid, status: 'closed' } } });
  return finish(rec, 'Open encerrado', 'open-inverno-teste', true);
}

/** 4) (opcional, --carga) Torneio grande para testar desempenho e telas com muitas linhas. */
function carga(opt: SeedOptions): SeedPlan {
  const tid = 'seed-carga';
  const rec = new Recorder(tid, Date.parse(at(opt.today)) - 5 * DAY);
  const f = athleteFactory(1003);
  const rng = mulberry32(2003);
  const start = addDays(opt.today, -2);
  rec.do({
    type: 'tournament.save',
    payload: {
      tournament: {
        id: tid, organizationId: opt.organizationId, organizationName: opt.organizationName,
        name: 'Circuito Estadual (carga, teste)', startDate: start, endDate: addDays(start, 3), city: 'Fortaleza', venue: 'Praia do Futuro',
        description: 'Dados fictícios de teste: muitas duplas e partidas, para medir desempenho.',
        slug: 'circuito-estadual-teste', status: 'open', publish: { ...FULL_PUBLISH, autoPublishOnSync: false }, defaults: { matchDurationMin: 30, restMin: 10 },
      },
    },
  });
  const courts = setCourts(rec, ['Quadra 1', 'Quadra 2', 'Quadra 3', 'Quadra 4', 'Quadra 5', 'Quadra 6'], 'Praia do Futuro');
  const cats: Array<{ id: string; name: string; kind: Kind; pairs: number; groups?: number }> = [
    { id: 'cat-mas', name: 'Masculina Open', kind: 'male', pairs: 32 },
    { id: 'cat-fem', name: 'Feminina Open', kind: 'female', pairs: 24, groups: 6 },
    { id: 'cat-mix', name: 'Mista Intermediária', kind: 'mixed', pairs: 32 },
    { id: 'cat-ini', name: 'Masculina Iniciante', kind: 'male', pairs: 16 },
  ];
  for (const c of cats) {
    rec.do({
      type: 'category.save',
      payload: {
        category: {
          id: c.id, name: c.name, gender: c.kind, level: c.id === 'cat-ini' ? 'beginner' : 'open',
          format: c.groups ? 'groups_then_knockout' : 'single_elimination', formatConfig: c.groups ? { groups: c.groups, advancePerGroup: 2 } : {},
          scoring: SETS_18, groupScoring: TARGET_18, tiebreakers: [...TIEBREAKERS], woCredit: 'none', waitlistEnabled: false, thirdPlaceMatch: true,
        },
      },
    });
    enroll(rec, f, { categoryId: c.id, prefix: c.id.slice(4), kind: c.kind, approved: c.pairs, seeds: 4, checkIn: 'most' });
  }
  cats.forEach((c, i) => generate(rec, c.id, 300 + i));
  scheduleAll(rec, at(start, 11), courts);
  for (const c of cats) play(rec, c.id, { rng, limit: Math.floor(c.pairs * 0.6) });
  return finish(rec, 'Circuito (carga)', 'circuito-estadual-teste', false);
}

export function buildSeedPlans(opt: SeedOptions): SeedPlan[] {
  // O app abre o torneio mais recentemente atualizado: a Copa (a mais completa) vai por último.
  const plans = [encerrado(opt), rascunho(opt)];
  if (opt.carga) plans.unshift(carga(opt));
  plans.push(copa(opt));
  return plans;
}
