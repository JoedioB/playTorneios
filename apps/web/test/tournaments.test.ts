import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
let reloads = 0;
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  location: { hash: '', reload: () => void reloads++ },
});
const t = await import('../src/lib/tournaments.ts');

test('sem escolha, o banco ativo é o padrão', () => {
  store.clear();
  assert.equal(t.activeDb(), t.DEFAULT_DB);
});

test('registra o torneio aberto e atualiza o nome sem duplicar', () => {
  store.clear();
  t.rememberCurrent('t1', 'Copa');
  t.rememberCurrent('t1', 'Copa 2026');
  assert.deepEqual(t.listKnown(), [{ id: 't1', name: 'Copa 2026', db: t.DEFAULT_DB }]);
});

test('abrir um torneio já conhecido troca o banco e recarrega, sem baixar nada', () => {
  store.clear();
  reloads = 0;
  t.rememberCurrent('t1', 'Copa'); // no banco padrão
  store.set('pt:active', 'playtorneios-t2');
  t.rememberCurrent('t2', 'Open'); // em outro banco
  t.openTournament('t1');
  assert.equal(t.activeDb(), t.DEFAULT_DB);
  assert.equal(t.wantedTournament(), null);
  assert.equal(reloads, 1);
});

test('abrir um torneio só do servidor usa um banco novo e pede o download', () => {
  store.clear();
  t.openTournament('abc-123');
  assert.equal(t.activeDb(), 'playtorneios-abc-123');
  assert.equal(t.wantedTournament(), 'abc-123');
  t.clearWanted();
  assert.equal(t.wantedTournament(), null);
});

test('criar novo torneio abre um banco vazio e marca "não baixar"', () => {
  store.clear();
  t.startNewTournament();
  assert.match(t.activeDb(), /^playtorneios-novo-[0-9a-f]{8}$/);
  assert.equal(t.wantedTournament(), t.WANT_NEW);
});

test('valor adulterado em pt:active é ignorado', () => {
  store.clear();
  store.set('pt:active', '../evil');
  assert.equal(t.activeDb(), t.DEFAULT_DB);
});

test('esquecer remove só o torneio indicado', () => {
  store.clear();
  t.rememberCurrent('t1', 'A');
  store.set('pt:active', 'playtorneios-x');
  t.rememberCurrent('t2', 'B');
  t.forget('t1');
  assert.deepEqual(t.listKnown().map((k) => k.id), ['t2']);
});
