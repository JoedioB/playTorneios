import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, emptyState } from '@playtorneios/domain';
import type { Command, TournamentState } from '@playtorneios/domain';
import { MemoryServerStore } from '@playtorneios/sync';
import { defaultExpiry, refereeCourtView, refereeDeviceId, refereePush } from '../src/referee-core.ts';
import type { RefereeCommand, RefereeLink } from '../src/referee-core.ts';

let n = 0;
const step = (s: TournamentState, cmd: Command): TournamentState => {
  n++;
  return apply(s, cmd, { now: new Date(Date.UTC(2026, 10, 1, 12, 0, n)).toISOString(), deviceId: 'org', opId: `o${n}` }).state;
};

function build(): { store: MemoryServerStore; q1Match: string; q2Match: string; pairs: [string, string] } {
  let s = emptyState();
  s = step(s, { type: 'tournament.save', payload: { tournament: { id: 't1', organizationId: 'org1', name: 'Copa', organizationName: 'Org', startDate: '2026-11-07', endDate: '2026-11-08', city: 'Natal', venue: 'Praia', slug: 'copa' } } });
  s = step(s, { type: 'court.save', payload: { court: { id: 'q1', name: 'Quadra 1' } } });
  s = step(s, { type: 'court.save', payload: { court: { id: 'q2', name: 'Quadra 2' } } });
  s = step(s, { type: 'category.save', payload: { category: { id: 'c1', name: 'Aberta', format: 'single_elimination', formatConfig: {}, scoring: { model: 'sets', bestOf: 3, setPoints: 18, decidingSetPoints: 15, winBy: 2 }, thirdPlaceMatch: false } } });
  for (let i = 1; i <= 4; i++) {
    s = step(s, { type: 'athlete.save', payload: { athlete: { id: `a${i}`, fullName: `Atleta ${i}A`, phone: '(00) 90000-0000', birthDate: '1990-01-01' } } });
    s = step(s, { type: 'athlete.save', payload: { athlete: { id: `b${i}`, fullName: `Atleta ${i}B` } } });
    s = step(s, { type: 'pair.save', payload: { pair: { id: `p${i}`, athleteAId: `a${i}`, athleteBId: `b${i}` } } });
    s = step(s, { type: 'registration.create', payload: { registrationId: `r${i}`, categoryId: 'c1', pairId: `p${i}` } });
    s = step(s, { type: 'registration.setStatus', payload: { registrationId: `r${i}`, status: 'approved' } });
  }
  s = step(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const firsts = Object.values(s.matches).filter((m) => m.round === 1).sort((x, y) => x.indexInRound - y.indexInRound);
  s = step(s, { type: 'match.schedule', payload: { matchId: firsts[0]!.id, courtId: 'q1', scheduledAt: '2026-11-07T09:00:00.000Z' } });
  s = step(s, { type: 'match.schedule', payload: { matchId: firsts[1]!.id, courtId: 'q2', scheduledAt: '2026-11-07T09:00:00.000Z' } });
  const store = new MemoryServerStore();
  store.states.set('t1', s);
  const first = firsts[0]!;
  const rm = apply(s, { type: 'match.start', payload: { matchId: first.id } }, { now: '2026-11-07T09:00:00.000Z', deviceId: 'x', opId: 'x' }); // só para achar as duplas
  void rm;
  return { store, q1Match: first.id, q2Match: firsts[1]!.id, pairs: ['', ''] };
}

const link: RefereeLink = { id: 'lk1', organizationId: 'org1', tournamentId: 't1', courtId: 'q1', label: 'João', expiresAt: '2026-11-08T23:59:59.000Z' };
const NOW = '2026-11-07T09:00:05.000Z';
const cmd = (opId: string, type: RefereeCommand['type'], payload: unknown): RefereeCommand => ({ opId, type, payload });

async function pairsOf(store: MemoryServerStore, matchId: string): Promise<[string, string]> {
  const v = await refereeCourtView(store, link);
  const m = v!.matches.find((x) => x.id === matchId)!;
  return [m.a!.id, m.b!.id];
}

test('a visão do juiz traz só a quadra dele e nenhum dado pessoal', async () => {
  const { store, q1Match, q2Match } = build();
  const v = (await refereeCourtView(store, link))!;
  assert.equal(v.court.name, 'Quadra 1');
  assert.deepEqual(v.matches.map((m) => m.id), [q1Match]);
  assert.ok(!v.matches.some((m) => m.id === q2Match));
  const text = JSON.stringify(v);
  for (const needle of ['(00)', '1990', 'phone', 'birthDate', 'email']) assert.ok(!text.includes(needle), needle);
});

test('fluxo completo: abrir, marcar, finalizar; o aparelho fica registrado como juiz', async () => {
  const { store, q1Match } = build();
  const [a, b] = await pairsOf(store, q1Match);
  const r1 = await refereePush(store, link, [cmd('op1', 'match.start', { matchId: q1Match }), cmd('op2', 'match.live_score', { matchId: q1Match, a: 5, b: 3 })], NOW);
  assert.deepEqual(r1.map((r) => r.status), ['applied', 'applied']);
  assert.equal(store.states.get('t1')!.matches[q1Match]!.live!.a, 5);
  const rec = cmd('op3', 'result.record', { resultId: 'res1', matchId: q1Match, kind: 'normal', sets: [{ a: 18, b: 10 }, { a: 18, b: 12 }], expectedA: a, expectedB: b });
  const [r2] = await refereePush(store, link, [rec], NOW);
  assert.equal(r2!.status, 'applied');
  const s = store.states.get('t1')!;
  assert.equal(s.matches[q1Match]!.lifecycle, 'finished');
  assert.equal(s.results[q1Match]![0]!.deviceId, refereeDeviceId('lk1'));
  assert.equal(s.results[q1Match]![0]!.recordedBy, link.label, 'o nome do juiz fica gravado na revisão');
  assert.equal(s.results[q1Match]![0]!.winnerPairId, a);
  // reenvio do mesmo comando não duplica
  const [again] = await refereePush(store, link, [rec], NOW);
  assert.equal(again!.status, 'duplicate');
  assert.equal(store.states.get('t1')!.results[q1Match]!.length, 1);
});

test('partida de outra quadra é recusada', async () => {
  const { store, q2Match } = build();
  const [r] = await refereePush(store, link, [cmd('x1', 'match.start', { matchId: q2Match })], NOW);
  assert.equal(r!.status, 'rejected');
  assert.equal(r!.error!.code, 'FORBIDDEN_MATCH');
  assert.equal(store.states.get('t1')!.matches[q2Match]!.lifecycle, 'not_started');
  const [ghost] = await refereePush(store, link, [cmd('x2', 'match.start', { matchId: 'nao-existe' })], NOW);
  assert.equal(ghost!.error!.code, 'FORBIDDEN_MATCH');
});

test('juiz não registra W.O., abandono nem correção, e precisa informar as duplas', async () => {
  const { store, q1Match } = build();
  const [a, b] = await pairsOf(store, q1Match);
  const base = { resultId: 'r', matchId: q1Match, expectedA: a, expectedB: b };
  const out = await refereePush(store, link, [
    cmd('w1', 'result.record', { ...base, resultId: 'r1', kind: 'walkover', winnerPairId: a }),
    cmd('w2', 'result.record', { ...base, resultId: 'r2', kind: 'retired', retiredPairId: a, sets: [{ a: 3, b: 1 }] }),
    cmd('w3', 'result.record', { ...base, resultId: 'r3', kind: 'normal', sets: [{ a: 18, b: 0 }, { a: 18, b: 0 }], reason: 'corrigindo algo' }),
    cmd('w4', 'result.record', { resultId: 'r4', matchId: q1Match, kind: 'normal', sets: [{ a: 18, b: 0 }, { a: 18, b: 0 }] }),
  ], NOW);
  assert.deepEqual(out.map((r) => r.error?.code), ['FORBIDDEN_KIND', 'FORBIDDEN_KIND', 'FORBIDDEN_CORRECTION', 'VALIDATION']);
  assert.equal(store.states.get('t1')!.results[q1Match], undefined);
});

test('se o organizador já registrou, o juiz recebe ALREADY_RECORDED', async () => {
  const { store, q1Match } = build();
  const [a, b] = await pairsOf(store, q1Match);
  const s = store.states.get('t1')!;
  store.states.set('t1', step(s, { type: 'result.record', payload: { resultId: 'org-res', matchId: q1Match, kind: 'normal', sets: [{ a: 18, b: 1 }, { a: 18, b: 2 }], expectedA: a, expectedB: b } }));
  const [r] = await refereePush(store, link, [cmd('d1', 'result.record', { resultId: 'ref-res', matchId: q1Match, kind: 'normal', sets: [{ a: 18, b: 9 }, { a: 18, b: 8 }], expectedA: a, expectedB: b })], NOW);
  assert.equal(r!.error!.code, 'ALREADY_RECORDED');
  assert.equal(store.states.get('t1')!.results[q1Match]!.length, 1);
});

test('placar inválido é recusado sem travar a próxima tentativa', async () => {
  const { store, q1Match } = build();
  const [a, b] = await pairsOf(store, q1Match);
  const bad = cmd('b1', 'result.record', { resultId: 'rr1', matchId: q1Match, kind: 'normal', sets: [{ a: 18, b: 17 }], expectedA: a, expectedB: b });
  const [r1] = await refereePush(store, link, [bad], NOW);
  assert.equal(r1!.status, 'rejected');
  assert.equal(r1!.error!.code, 'SCORE_INVALID');
  const good = cmd('b2', 'result.record', { resultId: 'rr2', matchId: q1Match, kind: 'normal', sets: [{ a: 18, b: 4 }, { a: 18, b: 6 }], expectedA: a, expectedB: b });
  const [r2] = await refereePush(store, link, [good], NOW);
  assert.equal(r2!.status, 'applied');
});

test('payload malformado é recusado pela validação', async () => {
  const { store, q1Match } = build();
  const out = await refereePush(store, link, [cmd('m1', 'match.live_score', { matchId: q1Match, a: -1, b: 0 }), cmd('m2', 'match.live_score', { matchId: q1Match, a: 1, b: 1, extra: true })], NOW);
  assert.deepEqual(out.map((r) => r.error?.code), ['VALIDATION', 'VALIDATION']);
});

test('o relógio da operação é o do servidor, não o do celular', async () => {
  const { store, q1Match } = build();
  await refereePush(store, link, [cmd('t1', 'match.start', { matchId: q1Match })], NOW);
  assert.equal(store.states.get('t1')!.matches[q1Match]!.updatedAt, NOW);
});

test('validade padrão: fim do último dia do torneio, no máximo 7 dias', () => {
  assert.equal(defaultExpiry('2026-11-08', '2026-11-07T12:00:00.000Z'), '2026-11-09T02:59:59.000Z');
  assert.equal(defaultExpiry('2026-12-30', '2026-11-07T12:00:00.000Z'), '2026-11-14T12:00:00.000Z');
  assert.equal(defaultExpiry('2026-11-01', '2026-11-07T12:00:00.000Z'), '2026-11-08T12:00:00.000Z');
  assert.equal(defaultExpiry(undefined, '2026-11-07T12:00:00.000Z'), '2026-11-08T12:00:00.000Z');
});
