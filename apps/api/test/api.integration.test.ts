// Testes de integração da API com Postgres real (app.inject, sem abrir porta).
// Rodam só quando TEST_DATABASE_URL está definida. ATENÇÃO: o teste APAGA o schema "public" desse banco,
// por isso o nome do banco precisa conter "test" ou "pt_api".
//   createdb pt_api && TEST_DATABASE_URL=postgres://localhost/pt_api pnpm --filter @playtorneios/api test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  test('integração com Postgres (pulado: defina TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  const dbName = new URL(url).pathname.replace('/', '');
  assert.match(dbName, /test|pt_api/, `Recusado: o banco "${dbName}" não parece ser de teste (o teste apaga o schema public).`);

  const { buildApp } = await import('../src/app.ts');
  const { loadConfig } = await import('../src/config.ts');
  const { createPool, migrate } = await import('../src/db.ts');
  const { buildSeedPlans } = await import('../src/seed/build.ts');

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    COOKIE_SECRET: 'x'.repeat(48),
    COOKIE_SECURE: 'false',
    ALLOW_SIGNUP: 'true',
  } as NodeJS.ProcessEnv);

  describe('API + Postgres', () => {
    let pool: ReturnType<typeof createPool>;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let ipCounter = 0;
    // Cada chamada usa um "IP" diferente para não esbarrar nos limites de taxa entre testes.
    const nextIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

    interface Call { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; csrf?: boolean; ip?: string }
    const call = async (path: string, o: Call = {}) => {
      const method = (o.method ?? (o.body === undefined ? 'GET' : 'POST')) as 'GET' | 'POST' | 'DELETE';
      const res = await app.inject({
        method,
        url: path,
        headers: {
          ...(o.csrf === false ? {} : { 'x-playtorneios': 'test' }),
          'x-forwarded-for': o.ip ?? nextIp(),
          ...(o.cookie ? { cookie: o.cookie } : {}),
          ...o.headers,
        },
        payload: o.body === undefined ? undefined : (o.body as object),
      });
      return res;
    };

    async function newAccount(): Promise<{ email: string; password: string; cookie: string; organizationId: string }> {
      const email = `${randomUUID().slice(0, 8)}@teste.dev`;
      const password = 'SenhaDeTeste#2026';
      const su = await call('/api/auth/signup', { body: { email, password, organizationName: `Org ${email}` } });
      assert.equal(su.statusCode, 201, su.body);
      const li = await call('/api/auth/login', { body: { email, password } });
      assert.equal(li.statusCode, 200, li.body);
      const cookie = li.cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ');
      return { email, password, cookie, organizationId: li.json().user.organizationId };
    }

    const plansFor = (organizationId: string) => buildSeedPlans({ today: new Date().toISOString().slice(0, 10), organizationId, organizationName: 'Org' });
    // Cada teste usa um torneio com id próprio (o id do seed é fixo; contas diferentes não podem compartilhá-lo).
    const byId = (plans: ReturnType<typeof plansFor>, id: string) => {
      const plan = plans.find((p) => p.tournamentId === id)!;
      const fresh = `${id}-${randomUUID().slice(0, 8)}`;
      const swap = <T,>(x: T): T => JSON.parse(JSON.stringify(x).split(id).join(fresh)) as T;
      return { ...plan, tournamentId: fresh, operations: swap(plan.operations), finalState: swap(plan.finalState) };
    };

    async function pushAll(cookie: string, ops: unknown[]): Promise<Array<{ opId: string; status: string; error?: unknown }>> {
      const out: Array<{ opId: string; status: string; error?: unknown }> = [];
      for (let i = 0; i < ops.length; i += 100) {
        const r = await call('/api/sync/push', { cookie, body: { operations: ops.slice(i, i + 100) } });
        assert.equal(r.statusCode, 200, r.body);
        out.push(...r.json().results);
      }
      return out;
    }

    before(async () => {
      pool = createPool(url);
      await pool.query('drop schema public cascade; create schema public;');
      await migrate(pool, () => {});
      app = await buildApp({ pool, config });
      await app.ready();
    });
    after(async () => {
      await app.close();
      await pool.end();
    });

    test('saúde e autenticação obrigatória', async () => {
      assert.equal((await call('/api/health')).statusCode, 200);
      assert.equal((await call('/api/tournaments')).statusCode, 401);
      assert.equal((await call('/api/sync/pull?tournamentId=x&since=-1')).statusCode, 401);
    });

    test('cadastro, login, sessão e logout', async () => {
      const a = await newAccount();
      const dup = await call('/api/auth/signup', { body: { email: a.email, password: a.password, organizationName: 'Outra' } });
      assert.equal(dup.statusCode, 409);
      assert.equal((await call('/api/auth/login', { body: { email: a.email, password: 'errada-errada' } })).statusCode, 401);
      assert.equal((await call('/api/auth/login', { body: { email: 'naoexiste@teste.dev', password: 'qualquer-coisa' } })).statusCode, 401);
      const me = await call('/api/auth/me', { cookie: a.cookie });
      assert.equal(me.statusCode, 200);
      assert.equal(me.json().user.email, a.email);
      const lo = await call('/api/auth/logout', { cookie: a.cookie, body: {} });
      assert.equal(lo.statusCode, 200);
      assert.equal((await call('/api/auth/me', { cookie: a.cookie })).statusCode, 401, 'a sessão encerrada não vale mais');
    });

    test('bloqueio após 5 senhas erradas (mesma resposta, nem a senha certa entra)', async () => {
      const a = await newAccount();
      for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/login', { body: { email: a.email, password: `errada-${i}-errada` } })).statusCode, 401);
      assert.equal((await call('/api/auth/login', { body: { email: a.email, password: a.password } })).statusCode, 401);
    });

    test('limite de login por IP: depois de N senhas erradas o endereço é bloqueado, mesmo com a senha certa', async () => {
      const a = await newAccount();
      const strict = await buildApp({ pool, config: { ...config, LOGIN_IP_MAX_FAILURES: 3 } });
      await strict.ready();
      try {
        const login = (email: string, password: string, ip: string) =>
          strict.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-playtorneios': 'test', 'x-forwarded-for': ip }, payload: { email, password } });
        const ip = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
        // E-mails que nem existem também contam: é assim que se tenta adivinhar contas em massa.
        for (let i = 0; i < 3; i++) assert.equal((await login(`ninguem${i}@teste.dev`, 'senha-errada-123', ip)).statusCode, 401);
        const blocked = await login(a.email, a.password, ip);
        assert.equal(blocked.statusCode, 429, blocked.body);
        assert.equal(blocked.json().error.code, 'TOO_MANY_ATTEMPTS');
        assert.ok(Number(blocked.headers['retry-after']) > 0);
        // Outro endereço não é afetado.
        assert.equal((await login(a.email, a.password, '198.51.100.7')).statusCode, 200);
      } finally {
        await strict.close();
      }
    });

    test('proteção CSRF: escrita sem o cabeçalho ou com origem de outro site é recusada', async () => {
      const a = await newAccount();
      const body = { operations: [{ nada: true }] };
      assert.equal((await call('/api/sync/push', { cookie: a.cookie, body, csrf: false })).statusCode, 403);
      const evil = await call('/api/sync/push', { cookie: a.cookie, body, headers: { origin: 'https://evil.example', host: 'app.example.com' } });
      assert.equal(evil.statusCode, 403);
    });

    test('sincronização completa: envio, idempotência, listagem e pull', async () => {
      const a = await newAccount();
      const plan = byId(plansFor(a.organizationId), 'seed-copa');
      const results = await pushAll(a.cookie, plan.operations);
      const bad = results.filter((r) => r.status !== 'applied');
      assert.deepEqual(bad, [], 'todas as operações devem ser aplicadas');
      assert.equal(results.length, plan.operations.length);

      const again = await pushAll(a.cookie, plan.operations.slice(0, 100));
      assert.ok(again.every((r) => r.status === 'duplicate'), 'reenvio é idempotente');

      const list = await call('/api/tournaments', { cookie: a.cookie });
      assert.ok(list.json().tournaments.some((t: { id: string }) => t.id === plan.tournamentId));

      const pull = await call(`/api/sync/pull?tournamentId=${plan.tournamentId}&since=-1`, { cookie: a.cookie });
      assert.equal(pull.statusCode, 200);
      const pj = pull.json();
      assert.deepEqual(Object.keys(pj.state.pairs).sort(), Object.keys(plan.finalState.pairs).sort());
      assert.equal(Object.keys(pj.state.matches).length, Object.keys(plan.finalState.matches).length);
      assert.equal(pj.state.tournament.status, 'open');
      const unchanged = await call(`/api/sync/pull?tournamentId=${plan.tournamentId}&since=${pj.cursor}`, { cookie: a.cookie });
      assert.equal(unchanged.json().unchanged, true);

      const csv = await call(`/api/tournaments/${plan.tournamentId}/export/registrations.csv`, { cookie: a.cookie });
      assert.equal(csv.statusCode, 200);
      assert.match(String(csv.headers['content-type']), /text\/csv/);
    });

    test('página pública: snapshot, ETag e 304', async () => {
      const a = await newAccount();
      const plan = byId(plansFor(a.organizationId), 'seed-encerrado');
      await pushAll(a.cookie, plan.operations);
      const slugRow = await pool.query('select slug from tournament_slugs where tournament_id = $1', [plan.tournamentId]);
      assert.equal(slugRow.rowCount, 1);
      const slug = slugRow.rows[0].slug as string;
      const pub = await call(`/api/public/${slug}`);
      assert.equal(pub.statusCode, 200, pub.body);
      const etag = String(pub.headers.etag);
      assert.ok(etag.length > 0);
      assert.equal((await call(`/api/public/${slug}`, { headers: { 'if-none-match': etag } })).statusCode, 304);
      // Sem dado pessoal sensível na página pública (telefone, data de nascimento).
      assert.doesNotMatch(pub.body, /\(00\) 90000/);
      assert.doesNotMatch(pub.body, /birthDate/);
      assert.equal((await call('/api/public/slug-que-nao-existe')).statusCode, 404);
    });

    test('isolamento entre organizações', async () => {
      const a = await newAccount();
      const b = await newAccount();
      const planA = byId(plansFor(a.organizationId), 'seed-rascunho');
      await pushAll(a.cookie, planA.operations);

      // B não enxerga nem altera o torneio de A.
      assert.equal((await call(`/api/sync/pull?tournamentId=${planA.tournamentId}&since=-1`, { cookie: b.cookie })).statusCode, 404);
      assert.equal((await call(`/api/tournaments/${planA.tournamentId}/export/registrations.csv`, { cookie: b.cookie })).statusCode, 404);
      assert.equal((await call(`/api/tournaments/${planA.tournamentId}`, { cookie: b.cookie, method: 'DELETE' })).statusCode, 404);
      assert.equal((await call(`/api/tournaments/${planA.tournamentId}/publish`, { cookie: b.cookie, body: {} })).statusCode, 404);
      const list = await call('/api/tournaments', { cookie: b.cookie });
      assert.deepEqual(list.json().tournaments, []);
      const hijack = await call('/api/sync/push', {
        cookie: b.cookie,
        body: { operations: [{ ...planA.operations[1], opId: `hijack-${randomUUID().slice(0, 8)}`, deviceId: 'b-device' }] },
      });
      assert.equal(hijack.statusCode, 403);
      // Id de torneio com curinga não vira prefixo de outro torneio.
      assert.equal((await call('/api/sync/pull?tournamentId=seed-%25&since=-1', { cookie: b.cookie })).statusCode, 400);
      // O torneio de A continua intacto.
      assert.equal((await call(`/api/sync/pull?tournamentId=${planA.tournamentId}&since=-1`, { cookie: a.cookie })).statusCode, 200);
    });

    test('envio concorrente das mesmas operações: sem erro 500 e cada operação aplicada uma única vez', async () => {
      const a = await newAccount();
      const plan = byId(plansFor(a.organizationId), 'seed-copa');
      const ops = plan.operations.slice(0, 40);
      const [r1, r2] = await Promise.all([
        call('/api/sync/push', { cookie: a.cookie, body: { operations: ops } }),
        call('/api/sync/push', { cookie: a.cookie, body: { operations: ops } }),
      ]);
      assert.equal(r1.statusCode, 200, r1.body);
      assert.equal(r2.statusCode, 200, r2.body);
      const all = [...r1.json().results, ...r2.json().results] as Array<{ opId: string; status: string }>;
      assert.ok(all.every((r) => r.status === 'applied' || r.status === 'duplicate'), JSON.stringify(all.filter((r) => r.status !== 'applied' && r.status !== 'duplicate')));
      for (const op of ops) assert.equal(all.filter((r) => r.opId === op.opId && r.status === 'applied').length, 1, op.opId);
      const count = await pool.query('select count(*)::int as n from applied_operations where tournament_id = $1', [plan.tournamentId]);
      assert.equal(count.rows[0].n, ops.length);
    });

    test('validação: operação inválida é recusada sozinha; lote grande demais, 400', async () => {
      const a = await newAccount();
      const plan = byId(plansFor(a.organizationId), 'seed-rascunho');
      const good = plan.operations[0]!;
      // A inválida é de outra entidade (a quadra); senão a boa ficaria "bloqueada" atrás dela.
      const r = await call('/api/sync/push', { cookie: a.cookie, body: { operations: [{ ...plan.operations[1]!, type: 'nao.existe' }, good] } });
      assert.equal(r.statusCode, 200, r.body);
      const res = r.json().results;
      assert.equal(res[0].status, 'rejected');
      assert.equal(res[1].status, 'applied');
      const many = Array.from({ length: 101 }, () => good);
      assert.equal((await call('/api/sync/push', { cookie: a.cookie, body: { operations: many } })).statusCode, 400);
      assert.equal((await call('/api/sync/push', { cookie: a.cookie, body: { operations: [] } })).statusCode, 400);
    });

    test('retenção: atletas de torneio encerrado há mais de 12 meses são anonimizados (estado e página pública)', async () => {
      const { runRetention } = await import('../src/retention.ts');
      const a = await newAccount();
      const plan = byId(plansFor(a.organizationId), 'seed-encerrado');
      await pushAll(a.cookie, plan.operations);
      const slug = (await pool.query('select slug from tournament_slugs where tournament_id = $1', [plan.tournamentId])).rows[0].slug as string;
      const someName = Object.values(plan.finalState.athletes)[0]!.fullName;
      assert.match((await call(`/api/public/${slug}`)).body, new RegExp(someName.split(' ')[0]!), 'antes: o nome aparece na página pública');

      const cfg = { ...config, RETENTION_MONTHS: 12 };
      const soon = await runRetention(pool, cfg, new Date().toISOString(), true);
      assert.equal(soon.details.filter((d) => d.tournamentId === plan.tournamentId).length, 0, 'ainda não venceu (encerrado há poucos meses)');

      const later = new Date(Date.now() + 14 * 31 * 86_400_000).toISOString();
      const dry = await runRetention(pool, cfg, later, true);
      assert.ok(dry.details.some((d) => d.tournamentId === plan.tournamentId), 'simulação enxerga o torneio');
      const unchangedByDry = await call(`/api/sync/pull?tournamentId=${plan.tournamentId}&since=-1`, { cookie: a.cookie });
      assert.ok(Object.values(unchangedByDry.json().state.athletes).every((x: any) => !x.anonymizedAt), 'simulação não altera nada');

      const real = await runRetention(pool, cfg, later);
      assert.ok(real.athletes >= Object.keys(plan.finalState.athletes).length);
      const pull = await call(`/api/sync/pull?tournamentId=${plan.tournamentId}&since=-1`, { cookie: a.cookie });
      const athletes = Object.values(pull.json().state.athletes) as Array<{ fullName: string; phone?: string; anonymizedAt?: string }>;
      assert.ok(athletes.every((x) => x.fullName === 'Atleta anonimizado' && !x.phone && x.anonymizedAt));
      assert.doesNotMatch((await call(`/api/public/${slug}`)).body, new RegExp(someName.split(' ')[0]!), 'depois: a página pública não mostra o nome');
      assert.equal(Object.keys(pull.json().state.matches).length, Object.keys(plan.finalState.matches).length, 'partidas e resultados ficam');
      // Repetir não faz nada.
      const again = await runRetention(pool, cfg, later);
      assert.equal(again.details.filter((d) => d.tournamentId === plan.tournamentId).length, 0);
      // Desligada com 0.
      assert.equal((await runRetention(pool, { ...config, RETENTION_MONTHS: 0 }, later)).athletes, 0);
    });

    test('slug da página pública: vários torneios com o mesmo nome e ids parecidos nunca colidem nem derrubam o envio', async () => {
      const a = await newAccount();
      const slugs = new Set<string>();
      for (let i = 0; i < 4; i++) {
        // Ids que começam igual (o sufixo do slug sai do início do id): o caso que derrubou o CI com 500.
        const plan = byId(plansFor(a.organizationId), 'seed-encerrado');
        await pushAll(a.cookie, plan.operations);
        const slug = (await pool.query('select slug from tournament_slugs where tournament_id = $1', [plan.tournamentId])).rows[0].slug as string;
        assert.ok(!slugs.has(slug), `slug repetido: ${slug}`);
        slugs.add(slug);
        assert.equal((await call(`/api/public/${slug}`)).statusCode, 200);
      }
      assert.equal(slugs.size, 4);
    });

    test('LGPD: excluir o torneio apaga estado, histórico, slug e página pública', async () => {
      const a = await newAccount();
      const plan = byId(plansFor(a.organizationId), 'seed-encerrado');
      await pushAll(a.cookie, plan.operations);
      const slug = (await pool.query('select slug from tournament_slugs where tournament_id = $1', [plan.tournamentId])).rows[0].slug as string;
      const del = await call(`/api/tournaments/${plan.tournamentId}`, { cookie: a.cookie, method: 'DELETE' });
      assert.equal(del.statusCode, 200, del.body);
      assert.equal((await call(`/api/public/${slug}`)).statusCode, 404);
      assert.equal((await call(`/api/sync/pull?tournamentId=${plan.tournamentId}&since=-1`, { cookie: a.cookie })).statusCode, 404);
      for (const [table, col] of [['tournament_states', 'tournament_id'], ['applied_operations', 'tournament_id'], ['tournament_slugs', 'tournament_id'], ['public_snapshots', 'tournament_id']] as const) {
        const n = await pool.query(`select count(*)::int as n from ${table} where ${col} = $1`, [plan.tournamentId]);
        assert.equal(n.rows[0].n, 0, table);
      }
      const left = await pool.query(`select count(*)::int as n from entity_versions where starts_with(key, $1)`, [`${plan.tournamentId}/`]);
      assert.equal(left.rows[0].n, 0);
    });

    test('juiz: link por quadra, escopo, privacidade, revogação e isolamento', async () => {
      const a = await newAccount();
      const b = await newAccount();
      const plan = byId(plansFor(a.organizationId), 'seed-copa');
      await pushAll(a.cookie, plan.operations);
      const st = plan.finalState as { matches: Record<string, { id: string; courtId?: string; lifecycle: string }> };
      const open = Object.values(st.matches).filter((m) => m.courtId && m.lifecycle !== 'finished');
      const mine = open[0]!;
      const other = open.find((m) => m.courtId !== mine.courtId);
      const tid = plan.tournamentId;

      // só o dono cria link; quadra inexistente é recusada
      assert.equal((await call(`/api/tournaments/${tid}/referee-links`, { cookie: b.cookie, body: { courtId: mine.courtId } })).statusCode, 404);
      assert.equal((await call(`/api/tournaments/${tid}/referee-links`, { cookie: a.cookie, body: { courtId: 'nao-existe' } })).statusCode, 400);
      const made = await call(`/api/tournaments/${tid}/referee-links`, { cookie: a.cookie, body: { courtId: mine.courtId, label: 'Quadra do teste' } });
      assert.equal(made.statusCode, 201, made.body);
      const { token, link } = made.json() as { token: string; link: { id: string } };
      const auth = { authorization: `Bearer ${token}` };
      const hash = (await pool.query('select token_hash from referee_links where id = $1', [link.id])).rows[0].token_hash as string;
      assert.notEqual(hash, token); // nunca em claro

      // sem token, com token errado e com a sessão do organizador: nada de acesso ao caminho do juiz
      assert.equal((await call('/api/referee/court', {})).statusCode, 401);
      assert.equal((await call('/api/referee/court', { headers: { authorization: 'Bearer ' + 'x'.repeat(43) } })).statusCode, 401);
      assert.equal((await call('/api/referee/court', { cookie: a.cookie })).statusCode, 401);

      // visão mínima: só a quadra dele e nenhum dado pessoal
      const view = await call('/api/referee/court', { headers: auth });
      assert.equal(view.statusCode, 200, view.body);
      const v = view.json() as { matches: Array<{ id: string }>; court: { id: string } };
      assert.equal(v.court.id, mine.courtId);
      assert.ok(v.matches.some((m) => m.id === mine.id));
      if (other) assert.ok(!v.matches.some((m) => m.id === other.id));
      for (const needle of ['phone', 'birthDate', 'email', '(00)']) assert.ok(!view.body.includes(needle), needle);

      // escrita: quadra dele passa; outra quadra e tipos fora da lista não
      const start = await call('/api/referee/push', { headers: auth, body: { commands: [{ opId: randomUUID(), type: 'match.start', payload: { matchId: mine.id } }] } });
      assert.equal(start.statusCode, 200, start.body);
      assert.equal(start.json().results.length, 1, start.body);
      if (other) {
        const bad = await call('/api/referee/push', { headers: auth, body: { commands: [{ opId: randomUUID(), type: 'match.start', payload: { matchId: other.id } }] } });
        assert.equal(bad.json().results[0].error.code, 'FORBIDDEN_MATCH');
      }
      const wrongType = await call('/api/referee/push', { headers: auth, body: { commands: [{ opId: randomUUID(), type: 'tournament.save', payload: {} }] } });
      assert.equal(wrongType.statusCode, 400);
      // o juiz não alcança as rotas do organizador
      assert.equal((await call('/api/tournaments', { headers: auth })).statusCode, 401);
      assert.equal((await call('/api/sync/push', { headers: auth, body: { operations: [] } })).statusCode, 401);

      // revogar encerra na hora; outra organização não revoga nem lista
      assert.equal((await call(`/api/tournaments/${tid}/referee-links/${link.id}`, { cookie: b.cookie, method: 'DELETE' })).statusCode, 404);
      assert.equal((await call(`/api/tournaments/${tid}/referee-links`, { cookie: b.cookie })).json().links.length, 0);
      const listed = (await call(`/api/tournaments/${tid}/referee-links`, { cookie: a.cookie })).json().links as Array<{ id: string }>;
      assert.ok(listed.some((l) => l.id === link.id), 'link listado');
      assert.equal((await call(`/api/tournaments/${tid}/referee-links/${link.id}`, { cookie: a.cookie, method: 'DELETE' })).statusCode, 200);
      assert.equal((await call('/api/referee/court', { headers: auth })).statusCode, 401);

      // link vencido também é recusado
      const made2 = await call(`/api/tournaments/${tid}/referee-links`, { cookie: a.cookie, body: { courtId: mine.courtId } });
      await pool.query(`update referee_links set expires_at = now() - interval '1 minute' where id = $1`, [made2.json().link.id]);
      assert.equal((await call('/api/referee/court', { headers: { authorization: `Bearer ${made2.json().token}` } })).statusCode, 401);

      // LGPD: excluir o torneio apaga os links
      assert.equal((await call(`/api/tournaments/${tid}`, { cookie: a.cookie, method: 'DELETE' })).statusCode, 200);
      assert.equal((await pool.query('select count(*)::int as n from referee_links where tournament_id = $1', [tid])).rows[0].n, 0);
    });
  });
}
