// Verificação estática (sem banco): toda tabela citada no SQL do código existe nas migrações.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('..', import.meta.url).pathname;
const migrations = readdirSync(`${dir}migrations`).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`${dir}migrations/${f}`, 'utf8')).join('\n');
const tables = new Set([...migrations.matchAll(/create table (?:if not exists )?(\w+)/gi)].map((m) => m[1] as string));
tables.add('schema_migrations');

test('as migrações criam as tabelas esperadas', () => {
  for (const t of ['organizations', 'users', 'sessions', 'tournament_states', 'applied_operations', 'entity_versions', 'entity_changes', 'sync_halts', 'sync_conflicts', 'tournament_slugs', 'public_snapshots']) assert.ok(tables.has(t), t);
});

test('todo SQL do código usa tabelas que existem', () => {
  const used = new Set<string>();
  for (const f of ['app.ts', 'auth.ts', 'pg-store.ts', 'db.ts']) {
    const src = readFileSync(`${dir}src/${f}`, 'utf8');
    for (const m of src.matchAll(/\b(?:from|join|into|update|delete from)\s+([a-z_]+)\b/gi)) {
      const t = (m[1] as string).toLowerCase();
      if (t.includes('_') || ['users', 'sessions', 'organizations'].includes(t)) used.add(t);
    }
  }
  const missing = [...used].filter((t) => !tables.has(t) && !['entity_changes_x'].includes(t));
  assert.deepEqual(missing, []);
});

test('o esquema tem as chaves que garantem idempotência e unicidade', () => {
  assert.match(migrations, /primary key \(device_id, op_id\)/);
  assert.match(migrations, /email citext not null unique/);
  assert.match(migrations, /create extension if not exists citext/);
});

test('sessões guardam só o hash do token', () => {
  assert.match(migrations, /token_hash text primary key/);
  assert.doesNotMatch(migrations, /\btoken text\b/);
});
