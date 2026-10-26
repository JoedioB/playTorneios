// Uso: node src/retention-cli.ts [--dry-run]   (docker compose run --rm --entrypoint "node src/retention-cli.ts" api --dry-run)
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { runRetention } from './retention.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
try {
  const dry = process.argv.includes('--dry-run');
  const r = await runRetention(pool, config, new Date().toISOString(), dry);
  console.log(`${dry ? '[simulação] ' : ''}retenção de ${config.RETENTION_MONTHS} meses: ${r.athletes} atleta(s) em ${r.tournaments} torneio(s)`);
  for (const d of r.details) console.log(`  ${d.tournamentId}: encerrado em ${d.closedAt.slice(0, 10)}, ${d.athletes} atleta(s)`);
} finally {
  await pool.end();
}
