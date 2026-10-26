import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Pool } from 'pg';
import type { Config } from './config.ts';

export const SESSION_COOKIE = 'pt_session';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface AuthedUser {
  userId: string;
  organizationId: string;
  email: string;
  tokenHash: string;
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

let dummy: Promise<string> | undefined;

/** Quantos minutos faltam para o IP voltar a poder tentar; 0 se não está bloqueado. */
export async function ipBlockedMinutes(pool: Pool, cfg: Config, ip: string): Promise<number> {
  const r = await pool.query(
    `select count(*)::int as n, min(at) as first from login_failures where ip = $1 and at > now() - ($2 || ' minutes')::interval`,
    [ip, String(cfg.LOGIN_IP_WINDOW_MIN)],
  );
  const { n, first } = r.rows[0] as { n: number; first: Date | null };
  if (n < cfg.LOGIN_IP_MAX_FAILURES || !first) return 0;
  // A tentativa mais antiga da janela sai da contagem em (first + janela).
  return Math.max(1, Math.ceil((new Date(first).getTime() + cfg.LOGIN_IP_WINDOW_MIN * 60000 - Date.now()) / 60000));
}

export async function recordLoginFailure(pool: Pool, ip: string): Promise<void> {
  await pool.query('insert into login_failures(ip) values ($1)', [ip]);
}

export type LoginOutcome = { ok: true; token: string; user: { id: string; email: string; organizationId: string } } | { ok: false; reason: 'invalid' | 'locked'; retryAfterMin?: number };

/** Mensagem única para "usuário inexistente" e "senha errada"; hash de mentira iguala o tempo de resposta. */
export async function login(pool: Pool, cfg: Config, email: string, password: string, userAgent?: string): Promise<LoginOutcome> {
  const r = await pool.query('select id, organization_id, email, password_hash, failed_logins, locked_until from users where email = $1', [email]);
  const u = r.rows[0];
  if (!u) {
    dummy ??= hashPassword('senha-de-mentira');
    await argon2.verify(await dummy, password).catch(() => false);
    return { ok: false, reason: 'invalid' };
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return { ok: false, reason: 'locked', retryAfterMin: Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000) };
  }
  const good = await argon2.verify(u.password_hash, password).catch(() => false);
  if (!good) {
    // Contagem atômica: tentativas paralelas não furam o limite.
    await pool.query(
      `update users set
         failed_logins = case when failed_logins + 1 >= $2 then 0 else failed_logins + 1 end,
         locked_until = case when failed_logins + 1 >= $2 then now() + ($3 || ' minutes')::interval else locked_until end
       where id = $1`,
      [u.id, MAX_FAILED, String(LOCK_MINUTES)],
    );
    return { ok: false, reason: 'invalid' };
  }
  await pool.query('update users set failed_logins = 0, locked_until = null where id = $1', [u.id]);
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into sessions(token_hash, user_id, expires_at, user_agent) values ($1,$2, now() + ($3 || ' days')::interval, $4)`,
    [sha256(token), u.id, String(cfg.SESSION_ABSOLUTE_DAYS), userAgent?.slice(0, 200) ?? null],
  );
  return { ok: true, token, user: { id: u.id, email: u.email, organizationId: u.organization_id } };
}

/** Valida o cookie: expira por inatividade (padrão 8 h) e por tempo absoluto (padrão 7 dias). */
export async function authenticate(pool: Pool, cfg: Config, token: string | undefined): Promise<AuthedUser | null> {
  if (!token) return null;
  const th = sha256(token);
  const r = await pool.query(
    `select s.user_id, u.organization_id, u.email from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and s.last_seen_at > now() - ($2 || ' hours')::interval`,
    [th, String(cfg.SESSION_IDLE_HOURS)],
  );
  const row = r.rows[0];
  if (!row) return null;
  await pool.query('update sessions set last_seen_at = now() where token_hash = $1', [th]);
  return { userId: row.user_id, organizationId: row.organization_id, email: row.email, tokenHash: th };
}

export async function logout(pool: Pool, tokenHash: string): Promise<void> {
  await pool.query('delete from sessions where token_hash = $1', [tokenHash]);
}

export async function signup(pool: Pool, email: string, password: string, organizationName: string): Promise<{ ok: true } | { ok: false; reason: 'exists' }> {
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const exists = await client.query('select 1 from users where email = $1', [email]);
    if (exists.rowCount) {
      await client.query('rollback');
      return { ok: false, reason: 'exists' };
    }
    const org = await client.query('insert into organizations(name) values ($1) returning id', [organizationName]);
    await client.query('insert into users(organization_id, email, password_hash) values ($1,$2,$3)', [org.rows[0].id, email, hash]);
    await client.query('commit');
    return { ok: true };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
