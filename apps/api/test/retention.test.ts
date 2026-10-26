import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '@playtorneios/domain';
import { MemoryServerStore, pushOperations } from '@playtorneios/sync';
import { buildSeedPlans } from '../src/seed/build.ts';
import { addMonths, athletesDue, closedAtOf, retentionOperations } from '../src/retention-core.ts';

const plans = buildSeedPlans({ today: '2026-10-25', organizationId: 'org-1', organizationName: 'Org' });
const closed = plans.find((p) => p.tournamentId === 'seed-encerrado')!;
const open = plans.find((p) => p.tournamentId === 'seed-copa')!;
const closedAt = closedAtOf(closed.finalState)!;

test('addMonths respeita o fim do mês', () => {
  assert.equal(addMonths('2026-01-31T10:00:00.000Z', 1).slice(0, 10), '2026-02-28');
  assert.equal(addMonths('2027-12-15T00:00:00.000Z', 12).slice(0, 10), '2028-12-15');
  assert.equal(addMonths('2028-02-29T00:00:00.000Z', 12).slice(0, 10), '2029-02-28');
});

test('o encerramento vem da trilha de auditoria; torneio aberto não tem', () => {
  assert.ok(closedAt && closedAt > '2026-09-01');
  assert.equal(closedAtOf(open.finalState), undefined);
});

test('só vence depois de 12 meses do encerramento', () => {
  const all = Object.keys(closed.finalState.athletes).sort();
  assert.deepEqual(athletesDue(closed.finalState, addMonths(closedAt, 12), 12), all, 'no dia exato já vence');
  assert.deepEqual(athletesDue(closed.finalState, addMonths(closedAt, 11), 12), [], '11 meses: ainda não');
  assert.deepEqual(athletesDue(closed.finalState, '2099-01-01T00:00:00.000Z', 0), [], '0 desliga');
  assert.deepEqual(athletesDue(open.finalState, '2099-01-01T00:00:00.000Z', 12), [], 'torneio aberto nunca');
});

test('torneio reaberto deixa de contar', () => {
  const reopened = apply(closed.finalState, { type: 'tournament.save', payload: { tournament: { id: 'seed-encerrado', status: 'open' }, reason: 'Reaberto para corrigir um resultado.' } }, { now: '2026-11-01T12:00:00.000Z', deviceId: 'd', opId: 'x' }).state;
  assert.deepEqual(athletesDue(reopened, '2099-01-01T00:00:00.000Z', 12), []);
});

test('anonimização pelo caminho de sync: dados pessoais somem, resultado e pódio ficam, e repetir não faz nada', async () => {
  const store = new MemoryServerStore();
  await pushOperations(store, closed.operations, '2026-10-25T12:00:00.000Z');
  const later = addMonths(closedAt, 13);
  const ops = retentionOperations(closed.finalState, 'seed-encerrado', later, 12);
  assert.equal(ops.length, Object.keys(closed.finalState.athletes).length);
  const res = await pushOperations(store, ops, later);
  assert.ok(res.every((r) => r.status === 'applied'), JSON.stringify(res.filter((r) => r.status !== 'applied')));

  const st = store.states.get('seed-encerrado')!;
  for (const a of Object.values(st.athletes)) {
    assert.equal(a.fullName, 'Atleta anonimizado');
    assert.equal(a.phone, undefined);
    assert.equal(a.birthDate, undefined);
    assert.equal(a.city, undefined);
    assert.ok(a.anonymizedAt);
  }
  assert.equal(Object.keys(st.matches).length, Object.keys(closed.finalState.matches).length, 'partidas intactas');
  assert.equal(Object.keys(st.results).length, Object.keys(closed.finalState.results).length, 'resultados intactos');
  assert.equal(st.tournament?.status, 'closed');
  assert.ok(!JSON.stringify(st).includes('(00) 90000'), 'nenhum telefone restou no estado');

  // Segunda rodada: nada a fazer (já anonimizados) e reenvio das mesmas operações é duplicata.
  assert.deepEqual(retentionOperations(st, 'seed-encerrado', later, 12), []);
  assert.ok((await pushOperations(store, ops, later)).every((r) => r.status === 'duplicate'));
});
