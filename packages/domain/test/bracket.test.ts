import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedPositions, generateSingleElimination, generateGroupsThenKnockout, validateFormat, roundRobin } from '../src/bracket.ts';

const ctx = { tournamentId: 't', categoryId: 'c', now: '2026-01-01T00:00:00Z' };
const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ pairId: `p${i + 1}` }));

test('seedPositions de 8', () => {
  assert.deepEqual(seedPositions(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('eliminação simples: byes vão para as melhores sementes', () => {
  const plan = generateSingleElimination(ctx, { pairs: mk(6), thirdPlace: true, seed: 7 });
  assert.equal(plan.meta.size, 8);
  assert.equal(plan.meta.byes, 2);
  const byes = plan.matches.filter((m) => m.slotA.kind === 'bye' || m.slotB.kind === 'bye');
  assert.equal(byes.length, 2);
  assert.equal(plan.matches.length, 4 + 2 + 1 + 1);
});

test('sorteio reproduzível pela semente', () => {
  const a = generateSingleElimination(ctx, { pairs: mk(10), thirdPlace: false, seed: 42 });
  const b = generateSingleElimination(ctx, { pairs: mk(10), thirdPlace: false, seed: 42 });
  assert.deepEqual(a, b);
});

test('round robin: todos contra todos exatamente uma vez', () => {
  for (const n of [3, 4, 5, 6]) {
    const ids = Array.from({ length: n }, (_, i) => `x${i}`);
    const seen = new Set<string>();
    for (const r of roundRobin(ids)) for (const [a, b] of r) seen.add([a, b].sort().join('|'));
    assert.equal(seen.size, (n * (n - 1)) / 2);
  }
});

test('grupos + mata-mata', () => {
  const plan = generateGroupsThenKnockout(ctx, { pairs: mk(8), groups: 2, advancePerGroup: 2, thirdPlace: true, seed: 1 });
  assert.equal(plan.meta.groups?.length, 2);
  assert.equal(plan.matches.filter((m) => m.phase === 'group').length, 12);
  assert.equal(plan.matches.filter((m) => m.phase === 'knockout').length, 4);
});

test('validateFormat recusa grupos pequenos', () => {
  assert.equal(validateFormat('groups_then_knockout', 5, { groups: 2, advancePerGroup: 1 }).ok, false);
  assert.equal(validateFormat('groups_then_knockout', 8, { groups: 2, advancePerGroup: 2 }).ok, true);
});
