import { buildPublicSnapshot, emptyState, registrationsCsv } from '@playtorneios/domain';
import type { TournamentState } from '@playtorneios/domain';
import { discardSchema, formatZodError, loginSchema, operationSchema, resolveConflictSchema, signupSchema } from '@playtorneios/contracts';
import { discardRejected, pullChanges, pushOperations, resolveConflictServer } from '@playtorneios/sync';
import type { Operation } from '@playtorneios/sync';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { SESSION_COOKIE, authenticate, login, logout, signup } from './auth.ts';
import type { AuthedUser } from './auth.ts';
import type { Config } from './config.ts';
import { PgServerStore } from './pg-store.ts';
import { createHash } from 'node:crypto';

export interface AppDeps {
  pool: Pool;
  config: Config;
  now?: () => string;
}

const MUTATION_HEADER = 'x-playtorneios';
type PushResultLike = { opId: string; status: 'rejected' | 'blocked'; error: { code: string; message: string } };

export async function buildApp(deps: AppDeps) {
  const { pool, config } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 1_000_000, trustProxy: 1 });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cookie, { secret: config.COOKIE_SECRET });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  app.decorateRequest('user', null);

  // Proteção CSRF: cookie SameSite=Strict + cabeçalho próprio exigido em toda escrita autenticada.
  app.addHook('preHandler', async (req: any, reply: any) => {
    const url: string = req.url.split('?')[0];
    if (url === '/api/health' || url.startsWith('/api/public/')) return;
    const publicAuth = url === '/api/auth/login' || url === '/api/auth/signup';
    if (!publicAuth) {
      const user = await authenticate(pool, config, req.cookies?.[SESSION_COOKIE]);
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sua sessão expirou. Entre novamente.' } });
      req.user = user;
    }
    // Defesa em profundidade além do SameSite: se o navegador informa a origem, ela precisa ser deste host.
    if (req.method !== 'GET' && req.method !== 'HEAD' && typeof req.headers.origin === 'string') {
      let ok = false;
      try {
        ok = new URL(req.headers.origin).hostname === String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(':')[0];
      } catch { /* origem inválida */ }
      if (!ok) return reply.code(403).send({ error: { code: 'CSRF', message: 'Requisição recusada.' } });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.headers[MUTATION_HEADER]) {
      return reply.code(403).send({ error: { code: 'CSRF', message: 'Requisição recusada.' } });
    }
  });

  app.get('/api/health', async () => ({ ok: true, time: now() }));

  // ---------- Autenticação ----------
  app.post('/api/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req: any, reply: any) => {
    if (!config.ALLOW_SIGNUP) return reply.code(403).send({ error: { code: 'SIGNUP_DISABLED', message: 'O cadastro está desativado.' } });
    const p = signupSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: { code: 'VALIDATION', message: formatZodError(p.error) } });
    const r = await signup(pool, p.data.email, p.data.password, p.data.organizationName);
    if (!r.ok) return reply.code(409).send({ error: { code: 'EMAIL_IN_USE', message: 'Não foi possível criar a conta com esses dados.' } });
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req: any, reply: any) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: { code: 'VALIDATION', message: formatZodError(p.error) } });
    const r = await login(pool, config, p.data.email, p.data.password, req.headers['user-agent']);
    if (!r.ok) {
      // Mesma resposta para senha errada e conta bloqueada: não revela quais e-mails existem.
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos, ou conta bloqueada por alguns minutos após muitas tentativas.' } });
    }
    reply.setCookie(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: 'strict', secure: config.COOKIE_SECURE, path: '/', maxAge: config.SESSION_ABSOLUTE_DAYS * 86400 });
    return { user: { email: r.user.email, organizationId: r.user.organizationId } };
  });

  app.post('/api/auth/logout', async (req: any, reply: any) => {
    await logout(pool, (req.user as AuthedUser).tokenHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req: any) => ({ user: { email: req.user.email, organizationId: req.user.organizationId } }));

  // ---------- Sincronização ----------
  const storeFor = (u: AuthedUser) => new PgServerStore(pool, u.organizationId);

  app.post('/api/sync/push', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req: any, reply: any) => {
    const u = req.user as AuthedUser;
    const raw = (req.body as { operations?: unknown })?.operations;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'Envie de 1 a 100 operações.' } });
    }
    // Validação por operação: uma operação inválida é rejeitada sozinha (e bloqueia as seguintes da mesma entidade).
    const invalid = new Map<number, PushResultLike>();
    const valid: Operation[] = [];
    const validIdx: number[] = [];
    const badEntities = new Set<string>();
    raw.forEach((r, i) => {
      const p = operationSchema.safeParse(r);
      const o = r as { opId?: unknown; tournamentId?: unknown; entityType?: unknown; entityId?: unknown };
      const ekey = `${o?.tournamentId}/${o?.entityType}/${o?.entityId}`;
      const opId = typeof o?.opId === 'string' ? o.opId : `invalid-${i}`;
      if (!p.success) {
        badEntities.add(ekey);
        invalid.set(i, { opId, status: 'rejected', error: { code: 'VALIDATION', message: formatZodError(p.error) } });
      } else if (badEntities.has(ekey)) {
        invalid.set(i, { opId, status: 'blocked', error: { code: 'BLOCKED', message: 'Aguardando uma operação anterior que foi recusada.' } });
      } else {
        valid.push(p.data as unknown as Operation);
        validIdx.push(i);
      }
    });
    const ops = valid;
    // Torneio criado offline sem sessão usa "local": a organização passa a ser a da sessão.
    for (const op of ops) {
      if (op.type === 'tournament.save') {
        const t = (op.payload as { tournament: { organizationId?: string } }).tournament;
        if (t.organizationId === 'local') t.organizationId = u.organizationId;
        if (t.organizationId !== undefined && t.organizationId !== u.organizationId) {
          return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Operação não permitida.' } });
        }
      }
    }
    // Todo torneio citado precisa pertencer à organização (ou ser criado agora por um tournament.save).
    for (const tid of new Set(ops.map((o) => o.tournamentId))) {
      const row = await pool.query('select organization_id from tournament_states where tournament_id = $1', [tid]);
      const creating = ops.some((o) => o.tournamentId === tid && o.type === 'tournament.save');
      if (row.rowCount ? row.rows[0].organization_id !== u.organizationId : !creating) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Operação não permitida.' } });
      }
    }
    let applied: Awaited<ReturnType<typeof pushOperations>> = [];
    try {
      if (ops.length > 0) applied = await pushOperations(storeFor(u), ops, now());
    } catch (e) {
      if (e instanceof Error && e.message === 'FORBIDDEN_TOURNAMENT') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Operação não permitida.' } });
      throw e;
    }
    const results = raw.map((_, i) => invalid.get(i) ?? applied[validIdx.indexOf(i)]);
    // LGPD: conflitos já resolvidos podem conter dados de atleta anonimizado; não há por que guardá-los.
    for (const [i, o] of ops.entries()) {
      if (o.type === 'athlete.anonymize' && applied[i]?.status === 'applied') {
        await pool.query(`delete from sync_conflicts where tournament_id = $1 and status <> 'open'`, [o.tournamentId]);
      }
    }
    // Publicação automática: regera o snapshot público dos torneios que mudaram.
    for (const tid of new Set(ops.map((o) => o.tournamentId))) {
      if (results.some((r) => r.status === 'applied')) await refreshSnapshotIfAuto(pool, u.organizationId, tid, now());
    }
    return { results };
  });

  app.get('/api/sync/pull', async (req: any, reply: any) => {
    const u = req.user as AuthedUser;
    const { tournamentId, since } = req.query as { tournamentId?: string; since?: string };
    if (!tournamentId || !/^[A-Za-z0-9-]{1,64}$/.test(tournamentId)) return reply.code(400).send({ error: { code: 'VALIDATION', message: 'Informe o torneio.' } });
    const own = await pool.query('select 1 from tournament_states where tournament_id = $1 and organization_id = $2', [tournamentId, u.organizationId]);
    if (!own.rowCount) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Torneio não encontrado.' } });
    return pullChanges(storeFor(u), tournamentId, Number(since ?? -1));
  });

  app.get('/api/tournaments', async (req: any) => {
    const u = req.user as AuthedUser;
    const r = await pool.query(
      `select tournament_id, state->'tournament'->>'name' as name from tournament_states where organization_id = $1 order by updated_at desc`,
      [u.organizationId],
    );
    return { tournaments: r.rows.map((x: any) => ({ id: x.tournament_id, name: x.name })) };
  });

  app.get('/api/sync/conflicts', async (req: any) => {
    const u = req.user as AuthedUser;
    const { tournamentId } = req.query as { tournamentId?: string };
    const r = await pool.query(
      `select c.record from sync_conflicts c join tournament_states t on t.tournament_id = c.tournament_id
       where t.organization_id = $1 and c.status = 'open' and ($2::text is null or c.tournament_id = $2)`,
      [u.organizationId, tournamentId ?? null],
    );
    return { conflicts: r.rows.map((x: any) => x.record) };
  });

  app.post('/api/sync/conflicts/:id/resolve', async (req: any, reply: any) => {
    const u = req.user as AuthedUser;
    const p = resolveConflictSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: { code: 'VALIDATION', message: formatZodError(p.error) } });
    const owner = await pool.query(
      `select 1 from sync_conflicts c join tournament_states t on t.tournament_id = c.tournament_id where c.id = $1 and t.organization_id = $2`,
      [req.params.id, u.organizationId],
    );
    if (!owner.rowCount) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Conflito não encontrado.' } });
    // "device" é concluído pelo reenvio da operação com `resolution`; só "server" é decidido aqui.
    if (p.data.keep === 'server') await resolveConflictServer(storeFor(u), req.params.id, now());
    return { ok: true };
  });

  app.post('/api/sync/discard', async (req: any, reply: any) => {
    const u = req.user as AuthedUser;
    const p = discardSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: { code: 'VALIDATION', message: formatZodError(p.error) } });
    const tid = p.data.entityKey.split('/')[0] as string;
    const owner = await pool.query('select 1 from tournament_states where tournament_id = $1 and organization_id = $2', [tid, u.organizationId]);
    if (!owner.rowCount) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Torneio não encontrado.' } });
    await discardRejected(storeFor(u), p.data.deviceId, p.data.entityKey);
    return { ok: true };
  });

  // ---------- Publicação e exportação ----------
  app.post('/api/tournaments/:id/publish', async (req: any, reply: any) => {
    const u = req.user as AuthedUser;
    const r = await refreshSnapshot(pool, u.organizationId, req.params.id, now());
    if (r === 'not_found') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Torneio não encontrado.' } });
    return { ok: true, published: r === 'published' };
  });

  app.get('/api/tournaments/:id/export/registrations.csv', async (req: any, reply: any) => {
    const u = req.user as AuthedUser;
    const state = await loadState(pool, u.organizationId, req.params.id);
    if (!state) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Torneio não encontrado.' } });
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="inscricoes.csv"');
    return registrationsCsv(state);
  });

  // LGPD: exclusão definitiva do torneio e de tudo que dele deriva.
  app.delete('/api/tournaments/:id', async (req: any, reply: any) => {
    const u = req.user as AuthedUser;
    const tid = req.params.id as string;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const own = await client.query('select 1 from tournament_states where tournament_id = $1 and organization_id = $2', [tid, u.organizationId]);
      if (!own.rowCount) {
        await client.query('rollback');
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Torneio não encontrado.' } });
      }
      await client.query('delete from tournament_slugs where tournament_id = $1', [tid]);
      await client.query('delete from sync_conflicts where tournament_id = $1', [tid]);
      await client.query('delete from applied_operations where tournament_id = $1 or op_id in (select op_id from sync_halts where starts_with(key, $2))', [tid, `${tid}/`]);
      await client.query('delete from entity_changes where starts_with(key, $1)', [`${tid}/`]);
      await client.query('delete from entity_versions where starts_with(key, $1)', [`${tid}/`]);
      await client.query('delete from sync_halts where starts_with(key, $1)', [`${tid}/`]);
      await client.query('delete from tournament_states where tournament_id = $1', [tid]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  // ---------- Página pública (sem autenticação, só lê o snapshot) ----------
  app.get('/api/public/:slug', async (req: any, reply: any) => {
    const r = await pool.query('select snapshot, etag from public_snapshots where slug = $1', [req.params.slug]);
    const row = r.rows[0];
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Este torneio não está publicado.' } });
    if (req.headers['if-none-match'] === row.etag) return reply.code(304).send();
    reply.header('etag', row.etag).header('cache-control', 'public, max-age=30, stale-while-revalidate=120');
    return row.snapshot;
  });

  app.setErrorHandler((err: any, _req: any, reply: any) => {
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: err.code ?? 'ERROR', message: err.message } });
    app.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Algo deu errado. Tente novamente.' } });
  });

  return app;
}

async function loadState(pool: Pool, org: string, tid: string): Promise<TournamentState | undefined> {
  const r = await pool.query('select state from tournament_states where tournament_id = $1 and organization_id = $2', [tid, org]);
  return (r.rows[0]?.state as TournamentState | undefined) ?? undefined;
}

async function refreshSnapshotIfAuto(pool: Pool, org: string, tid: string, now: string): Promise<void> {
  const st = await loadState(pool, org, tid);
  if (st?.tournament?.publish.published) {
    const has = await pool.query('select 1 from public_snapshots where tournament_id = $1', [tid]);
    if (st.tournament.publish.autoPublishOnSync || !has.rowCount) await refreshSnapshot(pool, org, tid, now);
  }
  // Despublicado: remove o snapshot imediatamente.
  if (st?.tournament && !st.tournament.publish.published) await pool.query('delete from public_snapshots where tournament_id = $1', [tid]);
}

/** Gera (ou remove, se despublicado) o snapshot público a partir da lista de permissão do domínio. */
export async function refreshSnapshot(pool: Pool, org: string, tid: string, now: string): Promise<'published' | 'unpublished' | 'not_found'> {
  const st = await loadState(pool, org, tid);
  if (!st?.tournament) return 'not_found';
  const snap = buildPublicSnapshot(st ?? emptyState(), now);
  if (!snap) {
    await pool.query('delete from public_snapshots where tournament_id = $1', [tid]);
    return 'unpublished';
  }
  const body = JSON.stringify(snap);
  const slugRow = await pool.query('select slug from tournament_slugs where tournament_id = $1', [tid]);
  const slug = (slugRow.rows[0]?.slug as string | undefined) ?? snap.tournament.slug;
  const etag = `"${createHash('sha1').update(body.replace(/"generatedAt":"[^"]*"/, '')).digest('hex')}"`;
  await pool.query(
    `insert into public_snapshots(slug, tournament_id, snapshot, etag) values ($1,$2,$3,$4)
     on conflict (slug) do update set snapshot = excluded.snapshot, etag = excluded.etag, updated_at = now()`,
    [slug, tid, body, etag],
  );
  return 'published';
}
