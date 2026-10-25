import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, DomainError, resolveCategory, categoryOutcome } from '../src/index.ts';
import type { Command } from '../src/index.ts';
import { run, setup } from './helpers.ts';

const win = (matchId: string, winner: 'a' | 'b', id: string): Command => ({
  type: 'result.record',
  payload: { resultId: id, matchId, kind: 'normal', sets: winner === 'a' ? [{ a: 18, b: 10 }, { a: 18, b: 12 }] : [{ a: 10, b: 18 }, { a: 12, b: 18 }] },
});
const ctx = { now: '2026-11-02T00:00:00.000Z', deviceId: 'd', opId: 'o' };
function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
  return undefined;
}

test('torneio encerrado é somente leitura até ser reaberto', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const m = Object.values(s.matches).find((x) => x.round === 1)!;
  s = run(s, { type: 'tournament.save', payload: { tournament: { id: 't1', status: 'closed' } } });
  assert.equal(code(() => apply(s, win(m.id, 'a', 'r1'), ctx)), 'TOURNAMENT_CLOSED');
  assert.equal(code(() => apply(s, { type: 'court.save', payload: { court: { id: 'q9', name: 'Nova' } } }, ctx)), 'TOURNAMENT_CLOSED');
  // anonimizar (LGPD) continua permitido
  apply(s, { type: 'athlete.anonymize', payload: { athleteId: 'a1' } }, ctx);
});

test('dupla em duas partidas ao mesmo tempo não é salva; quadra livre sim', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const ms = Object.values(s.matches).filter((x) => x.round === 1);
  s = run(s, { type: 'match.schedule', payload: { matchId: ms[0]!.id, courtId: 'q1', scheduledAt: '2026-11-07T11:00:00.000Z' } });
  s = run(s, { type: 'match.schedule', payload: { matchId: ms[1]!.id, courtId: 'q2', scheduledAt: '2026-11-07T11:00:00.000Z' } });
  assert.ok(s.matches[ms[1]!.id]!.courtId === 'q2');
});

test('refazer a chave com mesma semente preserva partidas finalizadas e seus placares', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 5 } });
  const semis = Object.values(s.matches).filter((x) => x.round === 1).sort((a, b) => a.indexInRound - b.indexInRound);
  s = run(s, win(semis[0]!.id, 'a', 'r1'));
  s = run(s, win(semis[1]!.id, 'b', 'r2'));
  assert.equal(s.matches[semis[0]!.id]!.lifecycle, 'finished');
  const attempt = (token?: string) =>
    apply(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 5, ...(token ? { confirmToken: token } : {}) } }, ctx).state;
  let next;
  try {
    next = attempt();
  } catch (e) {
    next = attempt(((e as DomainError).details as { token: string }).token);
  }
  assert.equal(next.matches[semis[0]!.id]!.lifecycle, 'finished');
  assert.equal(next.matches[semis[1]!.id]!.lifecycle, 'finished');
});

test('pódio de 3 duplas fica completo com a final decidida (sem disputa de 3º)', () => {
  let s = setup({ pairs: 3 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 2 } });
  const playable = (): string | undefined => {
    const r = resolveCategory(s, 'c1');
    return Object.values(s.matches)
      .sort((a, b) => a.round - b.round)
      .find((m) => s.matches[m.id]!.lifecycle !== 'finished' && !r.matches[m.id]!.autoBye && r.matches[m.id]!.a.kind === 'pair' && r.matches[m.id]!.b.kind === 'pair')?.id;
  };
  for (let i = 0; i < 5; i++) {
    const id = playable();
    if (!id) break;
    s = run(s, win(id, 'a', `r${i}`));
  }
  assert.equal(categoryOutcome(s, 'c1').complete, true);
});

test('resultado lançado com duplas diferentes das atuais é recusado (chave mudou em outro aparelho)', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const m = Object.values(s.matches).find((x) => x.round === 1)!;
  const r = resolveCategory(s, 'c1').matches[m.id]!;
  const a = (r.a as { pairId: string }).pairId;
  const b = (r.b as { pairId: string }).pairId;
  const ok = { ...(win(m.id, 'a', 'r1') as any).payload, expectedA: a, expectedB: b };
  apply(s, { type: 'result.record', payload: ok }, ctx);
  assert.equal(code(() => apply(s, { type: 'result.record', payload: { ...ok, expectedA: 'outra-dupla' } }, ctx)), 'PARTICIPANTS_CHANGED');
});

test('trocar atleta de dupla com partidas iniciadas exige confirmação e deixa auditoria; sem partidas, não', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'athlete.save', payload: { athlete: { id: 'novo', fullName: 'Reserva' } } });
  const pair = Object.values(s.pairs)[0]!;
  const swap = (confirmed?: boolean): Command => ({ type: 'pair.save', payload: { pair: { id: pair.id, athleteAId: 'novo', athleteBId: pair.athleteBId }, ...(confirmed ? { confirmed } : {}) } });
  // antes da chave: livre
  apply(s, swap(), ctx);
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const m = Object.values(s.matches).find((x) => x.round === 1)!;
  const r = resolveCategory(s, 'c1').matches[m.id]!;
  const pid = (r.a as { pairId: string }).pairId;
  const target = s.pairs[pid]!;
  s = run(s, win(m.id, 'a', 'rx'));
  const sw = (c?: boolean): Command => ({ type: 'pair.save', payload: { pair: { id: target.id, athleteAId: 'novo', athleteBId: target.athleteBId }, ...(c ? { confirmed: true } : {}) } });
  assert.equal(code(() => apply(s, sw(), ctx)), 'PAIR_CHANGE_CONFIRMATION_REQUIRED');
  const next = apply(s, sw(true), ctx).state;
  assert.ok(next.audit.some((x) => x.action === 'pair.athlete_changed'));
  assert.equal(next.results[m.id]!.length, 1, 'resultados preservados');
});

test('trocar posições na chave: sem resultados é livre; com resultado afetado pede confirmação e preserva o histórico', () => {
  let s = setup({ pairs: 8 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 7 } });
  const r1 = Object.values(s.matches).filter((x) => x.round === 1).sort((x, y) => x.indexInRound - y.indexInRound);
  const swap = (token?: string): Command => ({ type: 'bracket.swap', payload: { categoryId: 'c1', a: { matchId: r1[0]!.id, side: 'a' }, b: { matchId: r1[1]!.id, side: 'b' }, ...(token ? { confirmToken: token } : {}) } });
  const before = resolveCategory(s, 'c1').matches;
  const s2 = run(s, swap());
  const after = resolveCategory(s2, 'c1').matches;
  assert.deepEqual(after[r1[0]!.id]!.a, before[r1[1]!.id]!.b);
  assert.deepEqual(after[r1[1]!.id]!.b, before[r1[0]!.id]!.a);
  assert.ok(s2.audit.some((x) => x.action === 'bracket.swapped'));
  // com resultado lançado na primeira partida, a troca exige confirmação
  const s3 = run(s, win(r1[0]!.id, 'a', 'rs'));
  let token: string | undefined;
  try {
    apply(s3, swap(), ctx);
    assert.fail('deveria pedir confirmação');
  } catch (e) {
    assert.equal((e as DomainError).code, 'IMPACT_CONFIRMATION_REQUIRED');
    token = ((e as DomainError).details as { token: string }).token;
  }
  const s4 = apply(s3, swap(token), ctx).state;
  assert.equal(s4.results[r1[0]!.id]!.length, 1);
  assert.ok(s4.results[r1[0]!.id]![0]!.invalidatedAt, 'resultado invalidado, mas guardado no histórico');
});
