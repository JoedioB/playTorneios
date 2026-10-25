import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool, migrate } from './db.ts';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
await migrate(pool, (m) => console.log(m));
const app = await buildApp({ pool, config });

const stop = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: config.PORT, host: config.HOST });
