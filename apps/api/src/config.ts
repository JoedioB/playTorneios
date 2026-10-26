import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET precisa ter pelo menos 32 caracteres'),
  // Bloqueio por IP: depois de N senhas erradas na janela, o IP recebe 429 (mesmo com a senha certa).
  LOGIN_IP_MAX_FAILURES: z.coerce.number().int().min(1).default(30),
  LOGIN_IP_WINDOW_MIN: z.coerce.number().int().min(1).default(60),
  // Anonimiza atletas de torneios encerrados há mais de N meses (0 desliga).
  RETENTION_MONTHS: z.coerce.number().int().min(0).default(12),
  SESSION_IDLE_HOURS: z.coerce.number().default(8),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().default(7),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ALLOW_SIGNUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${msg}`);
  }
  return r.data;
}
