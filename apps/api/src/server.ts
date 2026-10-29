import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool, migrate } from './db.ts';
import { runRetention } from './retention.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
await migrate(pool, (m) => console.log(m));
const app = await buildApp({ pool, config });

// Higiene de sessões: remove as expiradas (absoluto ou por inatividade) uma vez por hora.
const purgeSessions = () =>
  pool
    .query(`delete from sessions where expires_at < now() or last_seen_at < now() - ($1 || ' hours')::interval`, [String(config.SESSION_IDLE_HOURS ?? 8)])
    .catch((e) => console.error('purge de sessões falhou', e.message));
const purgeRefereeLinks = () => pool.query(`delete from referee_links where expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days'`).catch((e) => console.error('purge de links de juiz falhou', e.message));
const purgeLoginFailures = () => pool.query(`delete from login_failures where at < now() - interval '1 day'`).catch((e) => console.error('purge de tentativas falhou', e.message));
void purgeSessions();
void purgeLoginFailures();
void purgeRefereeLinks();
const purgeTimer = setInterval(() => { void purgeSessions(); void purgeLoginFailures(); void purgeRefereeLinks(); }, 3_600_000);
purgeTimer.unref();

// Retenção de dados pessoais: uma vez por dia (e na subida) anonimiza atletas de torneios encerrados há mais de RETENTION_MONTHS.
const retention = () =>
  runRetention(pool, config)
    .then((r) => { if (r.athletes > 0) console.log(`retenção: ${r.athletes} atleta(s) anonimizado(s) em ${r.tournaments} torneio(s)`); })
    .catch((e) => console.error('retenção falhou', e.message));
setTimeout(() => void retention(), 60_000).unref();
setInterval(() => void retention(), 86_400_000).unref();

const stop = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: config.PORT, host: config.HOST });
