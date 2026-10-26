import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryOutcome, resolveCategory } from '@playtorneios/domain';
import { operationSchema } from '@playtorneios/contracts';
import { MemoryServerStore, pushOperations } from '@playtorneios/sync';
import { buildSeedPlans } from '../src/seed/build.ts';

const opt = { today: '2026-10-25', carga: true, organizationId: 'org-seed', organizationName: 'Organização de Teste' };
const plans = buildSeedPlans(opt);
const plan = (id: string) => plans.find((p) => p.tournamentId === id)!;

test('é determinístico', () => {
  const again = buildSeedPlans(opt);
  assert.deepEqual(again.map((p) => p.operations), plans.map((p) => p.operations));
});

test('toda operação passa pela validação da API e é aplicada pelo servidor', async () => {
  for (const p of plans) {
    const ids = new Set<string>();
    for (const op of p.operations) {
      const r = operationSchema.safeParse(op);
      assert.ok(r.success, `${p.tournamentId} ${op.opId} ${op.type}: ${r.success ? '' : r.error.message}`);
      assert.ok(!ids.has(op.opId), 'opId repetido');
      ids.add(op.opId);
    }
    const store = new MemoryServerStore();
    for (let i = 0; i < p.operations.length; i += 100) {
      const res = await pushOperations(store, p.operations.slice(i, i + 100), '2026-10-25T12:00:00.000Z');
      for (const x of res) assert.equal(x.status, 'applied', `${p.tournamentId} ${x.opId}: ${JSON.stringify(x.error)}`);
    }
    assert.deepEqual(store.states.get(p.tournamentId), p.finalState);
    // reenvio é idempotente
    const again = await pushOperations(store, p.operations.slice(0, 50), '2026-10-25T12:00:00.000Z');
    assert.ok(again.every((x) => x.status === 'duplicate'));
  }
});

test('copa: estágios variados', () => {
  const s = plan('seed-copa').finalState;
  const regs = Object.values(s.registrations);
  assert.equal(s.tournament?.status, 'open');
  assert.ok(regs.some((r) => r.status === 'waitlist'), 'lista de espera');
  assert.ok(regs.some((r) => r.status === 'pending'));
  assert.ok(regs.some((r) => r.status === 'canceled'));
  assert.ok(regs.some((r) => r.checkedInA && !r.checkedInB), 'check-in parcial');
  const kinds = new Set(Object.values(s.results).flat().map((r) => r.kind));
  assert.deepEqual([...kinds].sort(), ['normal', 'retired', 'walkover']);
  assert.ok(Object.values(s.results).some((revs) => revs.length > 1), 'correção');
  assert.ok(Object.values(s.matches).some((m) => m.lifecycle === 'in_progress'), 'partida ao vivo');
  assert.ok(Object.values(s.matches).every((m) => !m.courtId || s.courts[m.courtId]));
  const fem = resolveCategory(s, 'cat-fem');
  assert.ok(Object.values(fem.groups).some((g) => g.unresolvedTies.length > 0), 'empate em aberto');
  assert.equal(categoryOutcome(s, 'cat-mas').complete, false);
});

test('encerrado: pódio completo', () => {
  const s = plan('seed-encerrado').finalState;
  assert.equal(s.tournament?.status, 'closed');
  for (const c of ['cat-mas', 'cat-fem']) {
    const o = categoryOutcome(s, c);
    assert.ok(o.complete && o.first && o.second && o.third.length === 1, c);
  }
});

test('rascunho e carga', () => {
  assert.equal(plan('seed-rascunho').finalState.tournament?.status, 'draft');
  assert.equal(Object.keys(plan('seed-rascunho').finalState.pairs).length, 0);
  assert.equal(Object.keys(plan('seed-carga').finalState.pairs).length, 104);
});

test('nomes de atletas são únicos e fictícios', () => {
  for (const p of plans) {
    const names = Object.values(p.finalState.athletes).map((a) => a.fullName);
    assert.equal(new Set(names).size, names.length);
    assert.ok(Object.values(p.finalState.athletes).every((a) => (a.phone ?? '').startsWith('(00)')));
  }
});
