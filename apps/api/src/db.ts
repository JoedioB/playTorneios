import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import type { Pool } from 'pg';

export function createPool(url: string): Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // Sem este listener, um erro em conexão ociosa (ex.: reinício do Postgres) derruba o processo.
  pool.on('error', (e) => console.error('pg pool error', e.message));
  return pool;
}

/** Aplica as migrações em ordem, cada uma em transação, uma única vez. */
export async function migrate(pool: Pool, log: (m: string) => void = console.log): Promise<number> {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  let applied = 0;
  for (const f of files) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(727274)');
      const done = await client.query('select 1 from schema_migrations where name = $1', [f]);
      if (done.rowCount === 0) {
        await client.query(await readFile(join(dir, f), 'utf8'));
        await client.query('insert into schema_migrations(name) values ($1)', [f]);
        applied++;
        log(`migração aplicada: ${f}`);
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}
