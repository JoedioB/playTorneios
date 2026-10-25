import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, mulberry32 } from '@playtorneios/domain';
import type { Command } from '@playtorneios/domain';
import { MemoryServerStore, applyOperationServer } from '../src/index.ts';
import type { Operation } from '../src/index.ts';
import { T, boot, clientCanon, makeClient, serverCanon } from './helpers.ts';

async function drain(c: ReturnType<typeof makeClient>, faultsOff = true): Promise<void> {
  if (faultsOff) Object.assign(c.transport.faults, { dropRequest: 0, dropResponse: 0, duplicate: 0, offline: false });
  await c.engine.sync();
}

test('fluxo feliz: comandos locais chegam ao servidor e o estado converge', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(1), 'd1');
  await c.engine.init();
  for (const cmd of boot()) await c.engine.dispatch(cmd);
  await drain(c);
  assert.equal(c.engine.snapshot().ui, 'online');
  assert.equal(c.engine.outbox.length, 0);
  assert.equal(serverCanon(store), clientCanon(c.engine.state));
});

test('offline: nada se perde, fila persiste e reinício do app retoma', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(2), 'd1', { offline: true });
  await c.engine.init();
  for (const cmd of boot()) await c.engine.dispatch(cmd);
  await c.engine.sync();
  assert.equal(c.engine.snapshot().ui, 'offline');
  assert.equal(c.engine.outbox.length, 3);
  // "reinicia" o app: novo engine sobre o mesmo armazenamento
  const c2 = makeClient(store, mulberry32(3), 'ignored');
  c2.storage.state = c.storage.state;
  c2.storage.outbox = c.storage.outbox;
  c2.storage.meta = c.storage.meta;
  await c2.engine.init();
  assert.equal(c2.engine.outbox.length, 3);
  assert.equal(c2.engine.meta.deviceId, c.engine.meta.deviceId);
  await drain(c2);
  assert.equal(serverCanon(store), clientCanon(c2.engine.state));
});

test('resposta perdida depois do commit: reenvio devolve duplicate e não duplica efeito', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(4), 'd1');
  await c.engine.init();
  c.transport.faults.dropResponse = 1;
  await c.engine.dispatch(boot()[0] as Command);
  await c.engine.sync();
  assert.equal(c.engine.outbox.length, 1, 'cliente ainda acha que está pendente');
  assert.equal(store.states.get(T)?.audit.length, 1, 'servidor já aplicou');
  c.transport.faults.dropResponse = 0;
  await c.engine.sync();
  assert.equal(c.engine.outbox.length, 0);
  assert.equal(store.states.get(T)?.audit.length, 1, 'não reaplicou');
});

test('backoff exponencial 2/5/15/30/60 s com teto', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, () => 0.5, 'd1', { offline: true });
  await c.engine.init();
  await c.engine.dispatch(boot()[0] as Command);
  const delays: number[] = [];
  const orig = c.engine.opt.scheduler.setTimeout;
  c.engine.opt.scheduler.setTimeout = (fn, ms) => { delays.push(ms); return orig(fn, ms); };
  for (let i = 0; i < 7; i++) await c.engine.sync();
  assert.deepEqual(delays, [2000, 5000, 15000, 30000, 60000, 60000, 60000]);
});

test('compactação: só live_score pendente da mesma partida é substituído', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(5), 'd1', { offline: true });
  await c.engine.init();
  for (const cmd of boot()) await c.engine.dispatch(cmd);
  for (let i = 1; i <= 4; i++) {
    await c.engine.dispatch({ type: 'athlete.save', payload: { athlete: { id: `a${i}`, fullName: `A${i}` } } });
  }
  assert.equal(c.engine.outbox.length, 7);
  // live_score exige partida existente: monta chave localmente
  for (let i = 1; i <= 4; i++) {
    await c.engine.dispatch({ type: 'athlete.save', payload: { athlete: { id: `b${i}`, fullName: `B${i}` } } });
    await c.engine.dispatch({ type: 'pair.save', payload: { pair: { id: `p${i}`, athleteAId: `a${i}`, athleteBId: `b${i}` } } });
    await c.engine.dispatch({ type: 'registration.create', payload: { registrationId: `r${i}`, categoryId: 'c1', pairId: `p${i}` } });
    await c.engine.dispatch({ type: 'registration.setStatus', payload: { registrationId: `r${i}`, status: 'approved' } });
  }
  await c.engine.dispatch({ type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const m = Object.values(c.engine.state.matches)[0]!;
  const before = c.engine.outbox.length;
  for (let i = 0; i < 10; i++) await c.engine.dispatch({ type: 'match.live_score', payload: { matchId: m.id, a: i, b: 0 } });
  assert.equal(c.engine.outbox.length, before + 1);
  assert.equal(c.engine.outbox.filter((x) => x.op.type === 'result.record').length, 0);
  await drain(c);
  assert.equal(store.states.get(T)!.matches[m.id]!.live!.a, 9);
});

test('rejeição de domínio: fica visível, bloqueia as seguintes na entidade e pode ser descartada', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(6), 'd1');
  await c.engine.init();
  for (const cmd of boot()) await c.engine.dispatch(cmd);
  await drain(c);
  // Servidor tem uma regra a mais que o cliente não conhece: simulamos adulterando o estado local do cliente.
  c.engine.state = structuredClone(c.engine.state);
  await store.transaction(async (tx) => {
    const s = (await tx.getState(T))!;
    s.categories.c1!.lockedAt = '2026-11-01T00:00:00.000Z';
    await tx.putState(T, s);
  });
  await c.engine.dispatch({ type: 'category.save', payload: { category: { id: 'c1', thirdPlaceMatch: true } } });
  await c.engine.dispatch({ type: 'category.save', payload: { category: { id: 'c1', name: 'Outra' } } });
  await drain(c);
  const snap = c.engine.snapshot();
  assert.equal(snap.rejected, 1);
  assert.equal(snap.blocked, 1);
  const rej = c.engine.outbox.find((i) => i.status === 'rejected')!;
  assert.equal(rej.error?.code, 'CATEGORY_LOCKED');
  await c.engine.discardRejected(rej.op.opId);
  assert.equal(c.engine.outbox.length, 0);
  assert.equal((await c.storage.listDiscarded()).length, 1);
  assert.equal(store.states.get(T)!.categories.c1!.name, 'Outra');
  assert.equal(serverCanon(store), clientCanon(c.engine.state));
});

test('conflito: campos sobrepostos pedem decisão; campos distintos fazem merge', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(7), 'd1');
  await c.engine.init();
  for (const cmd of boot()) await c.engine.dispatch(cmd);
  await drain(c);
  const v0 = c.engine.meta.versions[`${T}/category:c1`];

  // Outro navegador altera a mesma categoria diretamente no servidor.
  const other: Operation = { opId: 'ext-1', deviceId: 'web2', seq: 1, type: 'category.save', entityType: 'category', entityId: 'c1', tournamentId: T, baseVersion: v0, payload: { category: { id: 'c1', name: 'Nome do servidor' } }, clientCreatedAt: '2026-11-02T10:00:00.000Z', schemaVersion: 1 };
  assert.equal((await applyOperationServer(store, other, 'x')).status, 'applied');

  // Este aparelho (ainda ciente só de v0) altera campo distinto: merge.
  await c.engine.dispatch({ type: 'category.save', payload: { category: { id: 'c1', capacity: 8 } } });
  await drain(c);
  assert.equal(c.engine.outbox.length, 0);
  assert.equal(store.states.get(T)!.categories.c1!.capacity, 8);

  // Campo sobreposto (nome): conflito.
  c.engine.meta.versions[`${T}/category:c1`] = v0;
  await c.engine.dispatch({ type: 'category.save', payload: { category: { id: 'c1', name: 'Nome do aparelho' } } });
  await drain(c);
  assert.equal(c.engine.snapshot().ui, 'conflict');
  assert.equal(store.states.get(T)!.categories.c1!.name, 'Nome do servidor');
  const item = c.engine.conflictItems()[0]!;
  const conflict = [...store.conflicts.values()].find((x) => x.id === item.conflictId)!;
  assert.equal((conflict.serverValue as { name: string }).name, 'Nome do servidor');

  // Manter este aparelho.
  await c.engine.resolveConflict(conflict, 'device');
  assert.equal(c.engine.outbox.length, 0);
  assert.equal(store.states.get(T)!.categories.c1!.name, 'Nome do aparelho');
  const saved = store.conflicts.get(conflict.id)!;
  assert.equal(saved.status, 'resolved_device');
  assert.equal((saved.overwrittenValue as { name: string }).name, 'Nome do servidor', 'valor antigo guardado');
});

test('conflito: manter o servidor descarta com registro e converge', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(8), 'd1');
  await c.engine.init();
  for (const cmd of boot()) await c.engine.dispatch(cmd);
  await drain(c);
  const v0 = c.engine.meta.versions[`${T}/category:c1`];
  await applyOperationServer(store, { opId: 'ext-1', deviceId: 'web2', seq: 1, type: 'category.save', entityType: 'category', entityId: 'c1', tournamentId: T, baseVersion: v0, payload: { category: { id: 'c1', name: 'Servidor' } }, clientCreatedAt: '2026-11-02T10:00:00.000Z', schemaVersion: 1 }, 'x');
  c.engine.meta.versions[`${T}/category:c1`] = v0;
  await c.engine.dispatch({ type: 'category.save', payload: { category: { id: 'c1', name: 'Aparelho' } } });
  await drain(c);
  const item = c.engine.conflictItems()[0]!;
  const conflict = [...store.conflicts.values()].find((x) => x.id === item.conflictId)!;
  await c.engine.resolveConflict(conflict, 'server');
  assert.equal(c.engine.outbox.length, 0);
  assert.equal((await c.storage.listDiscarded()).length, 1);
  assert.equal(c.engine.state.categories.c1!.name, 'Servidor');
  assert.equal(serverCanon(store), clientCanon(c.engine.state));
});

test('comando inválido localmente não entra na fila', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(9), 'd1');
  await c.engine.init();
  await assert.rejects(c.engine.dispatch({ type: 'court.save', payload: { court: { id: 'q', name: 'X' } } }), (e: unknown) => e instanceof DomainError);
  assert.equal(c.engine.outbox.length, 0);
});

// Convergência sob falhas: sequência aleatória de comandos de negócio, rede que perde pedidos,
// perde respostas e duplica entregas. No fim, cliente e servidor precisam estar idênticos.
test('propriedade: convergência sob perda, duplicação e reinícios (40 execuções)', async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed * 7919);
    const store = new MemoryServerStore();
    const c = makeClient(store, rng, 'dev', { dropRequest: 0.25, dropResponse: 0.25, duplicate: 0.2 });
    await c.engine.init();
    for (const cmd of boot()) await c.engine.dispatch(cmd);
    const pairs = 4 + (seed % 5);
    for (let i = 1; i <= pairs; i++) {
      await c.engine.dispatch({ type: 'athlete.save', payload: { athlete: { id: `a${i}`, fullName: `A${i}` } } });
      await c.engine.dispatch({ type: 'athlete.save', payload: { athlete: { id: `b${i}`, fullName: `B${i}` } } });
      await c.engine.dispatch({ type: 'pair.save', payload: { pair: { id: `p${i}`, athleteAId: `a${i}`, athleteBId: `b${i}` } } });
      await c.engine.dispatch({ type: 'registration.create', payload: { registrationId: `r${i}`, categoryId: 'c1', pairId: `p${i}` } });
      await c.engine.dispatch({ type: 'registration.setStatus', payload: { registrationId: `r${i}`, status: 'approved' } });
      if (rng() < 0.5) await c.engine.sync();
    }
    await c.engine.dispatch({ type: 'bracket.generate', payload: { categoryId: 'c1', seed } });
    let guard = 0;
    for (;;) {
      if (++guard > 100) break;
      const { resolveCategory } = await import('@playtorneios/domain');
      const res = resolveCategory(c.engine.state, 'c1');
      const next = Object.values(c.engine.state.matches).find((m) => {
        const r = res.matches[m.id]!;
        return !r.autoBye && !r.result && r.a.kind === 'pair' && r.b.kind === 'pair';
      });
      if (!next) break;
      const w = rng() < 0.5;
      await c.engine.dispatch({ type: 'match.live_score', payload: { matchId: next.id, a: 3, b: 2 } });
      await c.engine.dispatch({ type: 'result.record', payload: { resultId: `res${guard}`, matchId: next.id, kind: 'normal', sets: w ? [{ a: 18, b: 4 }, { a: 18, b: 9 }] : [{ a: 4, b: 18 }, { a: 9, b: 18 }] } });
      if (rng() < 0.4) await c.engine.sync();
      if (rng() < 0.1) {
        // reinício do app no meio do caminho
        const st = c.storage;
        const c2 = makeClient(store, rng, `x${seed}-${guard}`, { dropRequest: 0.25, dropResponse: 0.25, duplicate: 0.2 });
        c2.storage.state = st.state; c2.storage.outbox = st.outbox; c2.storage.meta = st.meta; c2.storage.discarded = st.discarded;
        await c2.engine.init();
        Object.assign(c, c2);
      }
    }
    await drain(c);
    assert.equal(c.engine.outbox.length, 0, `seed ${seed}: fila não esvaziou`);
    assert.equal(serverCanon(store), clientCanon(c.engine.state), `seed ${seed}: divergiu`);
    const results = Object.values(store.states.get(T)!.results).flat();
    assert.equal(new Set(results.map((r) => r.id)).size, results.length, `seed ${seed}: resultado duplicado`);
  }
});

test('gravação local atômica: se gravar falha, a mudança não é confirmada nem enfileirada', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(30), 'd1', { offline: true });
  await c.engine.init();
  const [first, ...rest] = boot();
  await c.engine.dispatch(first as Command);
  const original = c.storage.commit.bind(c.storage);
  c.storage.commit = async () => {
    throw new Error('disco cheio');
  };
  const seqBefore = c.engine.meta.seq;
  await assert.rejects(c.engine.dispatch(rest[0] as Command), /disco cheio/);
  assert.equal(c.engine.outbox.length, 1);
  assert.equal(c.engine.meta.seq, seqBefore);
  c.storage.commit = original;
  await c.engine.dispatch(rest[0] as Command);
  assert.equal(c.engine.outbox.length, 2);
  assert.equal(c.storage.outbox.size, 2);
});

test('dispatch concorrente com pull não perde a edição (serialização)', async () => {
  const store = new MemoryServerStore();
  const c = makeClient(store, mulberry32(31), 'd1');
  await c.engine.init();
  const cmds = boot();
  await c.engine.dispatch(cmds[0] as Command);
  await drain(c);
  await Promise.all([c.engine.pull(), c.engine.dispatch(cmds[1] as Command), c.engine.pull(), c.engine.dispatch(cmds[2] as Command)]);
  await drain(c);
  assert.equal(serverCanon(store), clientCanon(c.engine.state));
  assert.equal(c.engine.outbox.length, 0);
});
