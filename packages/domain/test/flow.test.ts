import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, categoryOutcome, DomainError, resolveCategory } from '../src/index.ts';
import type { Command } from '../src/index.ts';
import { run, setup } from './helpers.ts';

const win = (matchId: string, winner: 'a' | 'b', id = `res-${matchId}-${Math.random()}`): Command => ({
  type: 'result.record',
  payload: { resultId: id, matchId, kind: 'normal', sets: winner === 'a' ? [{ a: 18, b: 10 }, { a: 18, b: 12 }] : [{ a: 10, b: 18 }, { a: 12, b: 18 }] },
});

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
  return undefined;
}

test('eliminação simples de 4 duplas até o pódio, com disputa de 3º', () => {
  let s = setup({ pairs: 4, third: true });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 3 } });
  assert.ok(s.categories.c1?.lockedAt);
  const semis = Object.values(s.matches).filter((m) => m.round === 1).sort((a, b) => a.indexInRound - b.indexInRound);
  assert.equal(semis.length, 2);
  s = run(s, win(semis[0]!.id, 'a'));
  s = run(s, win(semis[1]!.id, 'b'));
  const res = resolveCategory(s, 'c1');
  const final = Object.values(s.matches).find((m) => m.label === 'Final')!;
  assert.equal(res.matches[final.id]!.a.kind, 'pair');
  s = run(s, win(final.id, 'a'));
  const third = Object.values(s.matches).find((m) => m.label.includes('3º'))!;
  s = run(s, win(third.id, 'b'));
  const out = categoryOutcome(s, 'c1');
  assert.ok(out.complete);
  assert.equal(out.third.length, 1);
  assert.notEqual(out.first, out.second);
});

test('placar inválido é recusado', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const m = Object.values(s.matches).find((x) => x.round === 1)!;
  const c = code(() =>
    apply(s, { type: 'result.record', payload: { resultId: 'x', matchId: m.id, kind: 'normal', sets: [{ a: 18, b: 17 }, { a: 18, b: 10 }] } }, { now: 'n', deviceId: 'd', opId: 'o' }),
  );
  assert.equal(c, 'SCORE_INVALID');
});

test('correção exige justificativa de 10+ caracteres e histórico é preservado', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const m = Object.values(s.matches).find((x) => x.round === 1 && x.indexInRound === 0)!;
  s = run(s, win(m.id, 'a', 'r1'));
  const bad = code(() => apply(s, { ...win(m.id, 'a', 'r2'), payload: { ...(win(m.id, 'a', 'r2').payload as object), reason: 'curto' } } as Command, { now: 'n', deviceId: 'd', opId: 'o' }));
  assert.equal(bad, 'REASON_REQUIRED');
  const corr = { type: 'result.record', payload: { ...(win(m.id, 'b', 'r2').payload as object), reason: 'Placar anotado errado na súmula' } } as Command;
  s = run(s, corr);
  assert.equal(s.results[m.id]!.length, 2);
  assert.equal(s.results[m.id]![1]!.revision, 2);
});

test('corrigir o vencedor com partida seguinte jogada exige confirmação e invalida em cascata', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const [m0, m1] = Object.values(s.matches).filter((x) => x.round === 1).sort((a, b) => a.indexInRound - b.indexInRound);
  s = run(s, win(m0!.id, 'a'));
  s = run(s, win(m1!.id, 'a'));
  const final = Object.values(s.matches).find((x) => x.label === 'Final')!;
  s = run(s, win(final.id, 'a'));
  const correction = { type: 'result.record', payload: { ...(win(m0!.id, 'b', 'fix').payload as object), reason: 'Dupla errada na súmula' } } as Command;
  let err: DomainError | undefined;
  try {
    apply(s, correction, { now: 'n', deviceId: 'd', opId: 'o' });
  } catch (e) {
    err = e as DomainError;
  }
  assert.equal(err?.code, 'IMPACT_CONFIRMATION_REQUIRED');
  const token = (err!.details as { token: string }).token;
  const confirmed = { ...correction, payload: { ...(correction.payload as object), confirmToken: token } } as Command;
  s = run(s, confirmed);
  const last = s.results[final.id]!.at(-1)!;
  assert.ok(last.invalidatedAt, 'final invalidada');
  assert.equal(s.results[final.id]!.length, 1, 'nada é apagado');
  assert.equal(s.matches[final.id]!.lifecycle, 'not_started');
});

test('token de impacto vira inválido se o estado mudar', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const m0 = Object.values(s.matches).find((x) => x.round === 1 && x.indexInRound === 0)!;
  s = run(s, win(m0.id, 'a'));
  let err: DomainError | undefined;
  try {
    apply(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 99 } }, { now: 'n', deviceId: 'd', opId: 'o' });
  } catch (e) {
    err = e as DomainError;
  }
  assert.equal(err?.code, 'IMPACT_CONFIRMATION_REQUIRED');
  const stale = 'deadbeef';
  assert.equal(
    code(() => apply(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 99, confirmToken: stale } }, { now: 'n', deviceId: 'd', opId: 'o' })),
    'IMPACT_CONFIRMATION_REQUIRED',
  );
});

test('grupos + mata-mata: classificados só aparecem com o grupo completo', () => {
  let s = setup({ pairs: 6, format: 'groups_then_knockout', groups: 2, advance: 2 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 5 } });
  const groupMatches = Object.values(s.matches).filter((m) => m.phase === 'group');
  assert.equal(groupMatches.length, 6);
  let res = resolveCategory(s, 'c1');
  const semi = Object.values(s.matches).find((m) => m.phase === 'knockout' && m.round === 1)!;
  assert.equal(res.matches[semi.id]!.a.kind, 'pending');
  for (const m of groupMatches) {
    s = run(s, { type: 'result.record', payload: { resultId: `g-${m.id}`, matchId: m.id, kind: 'normal', points: { a: 18, b: 10 } } });
  }
  res = resolveCategory(s, 'c1');
  assert.equal(res.matches[semi.id]!.a.kind, 'pair');
});

test('inscrição: capacidade e lista de espera', () => {
  let s = setup({ pairs: 0 });
  s = run(s, { type: 'category.save', payload: { category: { id: 'c1', capacity: 2, waitlistEnabled: true } } });
  for (let i = 1; i <= 3; i++) {
    s = run(s, { type: 'athlete.save', payload: { athlete: { id: `a${i}`, fullName: `A${i}` } } });
    s = run(s, { type: 'athlete.save', payload: { athlete: { id: `b${i}`, fullName: `B${i}` } } });
    s = run(s, { type: 'pair.save', payload: { pair: { id: `p${i}`, athleteAId: `a${i}`, athleteBId: `b${i}` } } });
    s = run(s, { type: 'registration.create', payload: { registrationId: `r${i}`, categoryId: 'c1', pairId: `p${i}` } });
    if (i <= 2) s = run(s, { type: 'registration.setStatus', payload: { registrationId: `r${i}`, status: 'approved' } });
  }
  assert.equal(s.registrations.r3!.status, 'waitlist');
  s = run(s, { type: 'registration.setStatus', payload: { registrationId: 'r1', status: 'canceled' } });
  assert.equal(s.registrations.r3!.status, 'pending');
});

test('regras ficam congeladas depois de gerar a chave', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  assert.equal(
    code(() => apply(s, { type: 'category.save', payload: { category: { id: 'c1', thirdPlaceMatch: true } } }, { now: 'n', deviceId: 'd', opId: 'o' })),
    'CATEGORY_LOCKED',
  );
  s = run(s, { type: 'category.save', payload: { category: { id: 'c1', name: 'Renomeada' } } });
  assert.equal(s.categories.c1!.name, 'Renomeada');
});

test('anonimização remove dados pessoais e mantém resultados', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'athlete.save', payload: { athlete: { id: 'a1', phone: '8499999', birthDate: '1990-01-01' } } });
  s = run(s, { type: 'athlete.anonymize', payload: { athleteId: 'a1' } });
  assert.equal(s.athletes.a1!.fullName, 'Atleta anonimizado');
  assert.equal(s.athletes.a1!.phone, undefined);
  assert.ok(s.athletes.a1!.anonymizedAt);
});

test('apply não muta o estado de entrada', () => {
  const s = setup({ pairs: 4 });
  const before = JSON.stringify(s);
  apply(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } }, { now: 'n', deviceId: 'd', opId: 'o' });
  assert.equal(JSON.stringify(s), before);
});

test('encerrar e reabrir o torneio: reabrir exige justificativa', () => {
  let s = setup({ pairs: 2 });
  s = run(s, { type: 'tournament.save', payload: { tournament: { id: 't1', status: 'closed' } } });
  assert.equal(s.tournament!.status, 'closed');
  assert.equal(
    code(() => apply(s, { type: 'tournament.save', payload: { tournament: { id: 't1', status: 'open' } } }, { now: 'n', deviceId: 'd', opId: 'o' })),
    'REASON_REQUIRED',
  );
  s = run(s, { type: 'tournament.save', payload: { tournament: { id: 't1', status: 'open' }, reason: 'Faltou lançar a final' } });
  assert.equal(s.tournament!.status, 'open');
  assert.ok(s.audit.some((a) => a.action === 'tournament.status.open' && a.reason));
});
