import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '@playtorneios/domain';
import { setupSteps } from '../src/lib/steps.ts';

const base = () => {
  const s: any = emptyState();
  s.tournament = { id: 't', name: 'Copa', city: 'Natal' };
  return s;
};
const cat = (id: string) => ({ id, name: id });
const reg = (id: string, categoryId: string, status: string, pairId = id) => ({ id, categoryId, pairId, status, checkedInA: false, checkedInB: false });

test('sem nada cadastrado: só o torneio está concluído e o primeiro pendente é Quadras', () => {
  const steps = setupSteps(base());
  assert.deepEqual(steps.map((s) => s.key), ['torneio', 'quadras', 'categorias', 'duplas', 'aprovacao', 'chaves', 'agenda', 'checkin']);
  assert.equal(steps[0]!.done, true);
  assert.equal(steps.find((s) => !s.done && !s.optional)!.key, 'quadras');
});

test('quadra e categoria concluem seus passos; duplas pedem 2 inscrições na mesma categoria', () => {
  const s = base();
  s.courts = { c1: { id: 'c1', name: 'Quadra 1' } };
  s.categories = { k1: cat('k1') };
  let steps = setupSteps(s);
  assert.equal(steps.find((x) => x.key === 'quadras')!.done, true);
  assert.equal(steps.find((x) => x.key === 'categorias')!.done, true);
  assert.equal(steps.find((x) => x.key === 'duplas')!.done, false);
  s.registrations = { r1: reg('r1', 'k1', 'pending'), r2: reg('r2', 'k1', 'pending') };
  steps = setupSteps(s);
  assert.equal(steps.find((x) => x.key === 'duplas')!.done, true);
  assert.equal(steps.find((x) => x.key === 'aprovacao')!.done, false);
  assert.match(steps.find((x) => x.key === 'aprovacao')!.detail, /2 inscrição/);
});

test('inscrição cancelada não conta; aprovação e chaves dependem de 2 aprovadas', () => {
  const s = base();
  s.categories = { k1: cat('k1') };
  s.registrations = { r1: reg('r1', 'k1', 'approved'), r2: reg('r2', 'k1', 'canceled') };
  assert.equal(setupSteps(s).find((x) => x.key === 'duplas')!.done, false);
  s.registrations.r2 = reg('r2', 'k1', 'approved');
  const steps = setupSteps(s);
  assert.equal(steps.find((x) => x.key === 'aprovacao')!.done, true);
  const chaves = steps.find((x) => x.key === 'chaves')!;
  assert.equal(chaves.done, false);
  assert.equal(chaves.to, '/chaves/k1');
  s.brackets = { k1: { categoryId: 'k1' } };
  assert.equal(setupSteps(s).find((x) => x.key === 'chaves')!.done, true);
});

test('check-in é opcional e só conclui quando todas as aprovadas têm os dois atletas', () => {
  const s = base();
  s.categories = { k1: cat('k1') };
  s.registrations = { r1: { ...reg('r1', 'k1', 'approved'), checkedInA: true, checkedInB: true }, r2: reg('r2', 'k1', 'approved') };
  const ck = () => setupSteps(s).find((x) => x.key === 'checkin')!;
  assert.equal(ck().optional, true);
  assert.equal(ck().done, false);
  s.registrations.r2 = { ...s.registrations.r2, checkedInA: true, checkedInB: true };
  assert.equal(ck().done, true);
});
