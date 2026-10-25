import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

const ok = { DATABASE_URL: 'postgres://u:p@db/x', COOKIE_SECRET: 'x'.repeat(32) };

test('configuração mínima válida usa padrões seguros', () => {
  const c = loadConfig(ok);
  assert.equal(c.COOKIE_SECURE, true);
  assert.equal(c.SESSION_IDLE_HOURS, 8);
  assert.equal(c.SESSION_ABSOLUTE_DAYS, 7);
});

test('falha rápida e com mensagem clara quando falta segredo ou ele é curto', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'x' }), /COOKIE_SECRET/);
  assert.throws(() => loadConfig({ ...ok, COOKIE_SECRET: 'curto' }), /pelo menos 32/);
  assert.throws(() => loadConfig({ COOKIE_SECRET: ok.COOKIE_SECRET }), /DATABASE_URL/);
});
