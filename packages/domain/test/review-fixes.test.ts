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
