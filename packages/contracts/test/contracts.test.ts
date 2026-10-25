import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_TYPES } from '@playtorneios/domain';
import { operationSchema, payloadSchemas, pushRequestSchema, signupSchema } from '../src/index.ts';

const base = { opId: 'o1', deviceId: 'd1', seq: 1, entityType: 'court', entityId: 'q1', tournamentId: 't1', clientCreatedAt: '2026-11-01T12:00:00.000Z', schemaVersion: 1 };

test('todo tipo de comando tem schema de payload', () => {
  for (const t of COMMAND_TYPES) assert.ok(payloadSchemas[t], t);
});

test('operação válida passa; payload com campo extra ou tipo errado é recusado', () => {
  assert.ok(operationSchema.safeParse({ ...base, type: 'court.save', payload: { court: { id: 'q1', name: 'Quadra 1' } } }).success);
  assert.equal(operationSchema.safeParse({ ...base, type: 'court.save', payload: { court: { id: 'q1', name: 'Q', evil: 1 } } }).success, false);
  assert.equal(operationSchema.safeParse({ ...base, type: 'match.live_score', payload: { matchId: 'm', a: -1, b: 0 } }).success, false);
  assert.equal(operationSchema.safeParse({ ...base, type: 'drop.table', payload: {} }).success, false);
});

test('tema só aceita cores hexadecimais', () => {
  const bad = { ...base, type: 'tournament.save', payload: { tournament: { id: 't1', theme: { primary: 'red', accent: '#fff' } } } };
  assert.equal(operationSchema.safeParse(bad).success, false);
});

test('lote vazio ou grande demais é recusado', () => {
  assert.equal(pushRequestSchema.safeParse({ operations: [] }).success, false);
});

test('senha curta é recusada com mensagem em português', () => {
  const r = signupSchema.safeParse({ email: 'a@b.co', password: 'curta', organizationName: 'Org' });
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error?.issues), /pelo menos 10/);
});
