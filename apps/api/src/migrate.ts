import { loadConfig } from './config.ts';
import { createPool, migrate } from './db.ts';

const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL);
try {
  const n = await migrate(pool);
  console.log(n === 0 ? 'banco já está atualizado' : `${n} migração(ões) aplicada(s)`);
} finally {
  await pool.end();
}
