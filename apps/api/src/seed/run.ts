// Popula o banco com dados fictícios, usando a API real (cadastro, login e /api/sync/push).
// Uso:  node src/seed/run.ts [--reset] [--carga]
//   --reset  apaga e recria os torneios de teste (ids "seed-*"); sem isso, torneios que já existem são mantidos
//   --carga  inclui o torneio grande (104 duplas) para testes de desempenho
//   --only=copa|encerrado|rascunho|carga  cria só esse torneio
// Variáveis: API_URL (padrão http://localhost:8080), SEED_EMAIL, SEED_PASSWORD, SEED_ORG
import { buildSeedPlans } from './build.ts';
import type { SeedPlan } from './build.ts';

const API = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const EMAIL = process.env.SEED_EMAIL ?? 'organizador@teste.playtorneios.dev';
const PASSWORD = process.env.SEED_PASSWORD ?? 'SenhaDeTeste#2026';
const ORG = process.env.SEED_ORG ?? 'Federação de Futevôlei (dados de teste)';
const args = new Set(process.argv.slice(2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cookie = '';

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-playtorneios': 'seed', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) {
      await sleep(15_000); // limite de requisições: espera a janela passar
      continue;
    }
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json, text, headers: res.headers };
  }
}

async function waitForApi(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${API}/api/health`);
      if (r.ok) return;
    } catch { /* ainda subindo */ }
    await sleep(1500);
  }
  throw new Error(`A API não respondeu em ${API}. Ela está rodando? (use API_URL para apontar outro endereço)`);
}

async function authenticate(): Promise<string> {
  const su = await call('POST', '/api/auth/signup', { email: EMAIL, password: PASSWORD, organizationName: ORG });
  if (su.status === 403 && su.json?.error?.code === 'SIGNUP_DISABLED') console.log('  cadastro desativado; tentando entrar com a conta existente');
  else if (su.status === 201) console.log(`  conta criada: ${EMAIL}`);
  else if (su.status === 409) console.log(`  conta já existia: ${EMAIL}`);
  else throw new Error(`Cadastro falhou (${su.status}): ${su.text}`);
  const li = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  if (li.status !== 200) throw new Error(`Login falhou (${li.status}). Se a conta já existe com outra senha, defina SEED_PASSWORD. Resposta: ${li.text}`);
  const set = li.headers.getSetCookie?.() ?? [];
  cookie = set.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('O servidor não devolveu o cookie de sessão.');
  return li.json.user.organizationId as string;
}

async function pushPlan(plan: SeedPlan): Promise<void> {
  const ops = plan.operations;
  for (let i = 0; i < ops.length; i += 100) {
    const r = await call('POST', '/api/sync/push', { operations: ops.slice(i, i + 100) });
    if (r.status !== 200) throw new Error(`push falhou (${r.status}): ${r.text}`);
    for (const x of r.json.results as Array<{ opId: string; status: string; error?: { code: string; message: string } }>) {
      if (x.status !== 'applied' && x.status !== 'duplicate') throw new Error(`${plan.tournamentId}: operação ${x.opId} → ${x.status} ${x.error?.code ?? ''} ${x.error?.message ?? ''}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`playTorneios · seed de dados fictícios → ${API}`);
  await waitForApi();
  const organizationId = await authenticate();

  const only = [...args].find((a) => a.startsWith('--only='))?.slice(7);
  const plans = buildSeedPlans({
    today: new Date().toISOString().slice(0, 10),
    carga: args.has('--carga') || only === 'carga',
    organizationId,
    organizationName: ORG,
  }).filter((p) => !only || p.tournamentId === `seed-${only}`);
  if (plans.length === 0) throw new Error('--only deve ser copa, encerrado, rascunho ou carga.');

  const existing = new Set<string>(((await call('GET', '/api/tournaments')).json?.tournaments ?? []).map((t: { id: string }) => t.id));
  for (const plan of plans) {
    if (existing.has(plan.tournamentId)) {
      if (!args.has('--reset')) {
        console.log(`  = ${plan.title}: já existe (use --reset para recriar)`);
        continue;
      }
      const d = await call('DELETE', `/api/tournaments/${plan.tournamentId}`);
      if (d.status !== 200 && d.status !== 204) throw new Error(`Não foi possível apagar ${plan.tournamentId} (${d.status}): ${d.text}`);
    }
    await pushPlan(plan);
    if (plan.publish) await call('POST', `/api/tournaments/${plan.tournamentId}/publish`);
    const st = plan.finalState;
    console.log(`  + ${plan.title}: ${Object.keys(st.pairs).length} duplas, ${Object.keys(st.matches).length} partidas, ${plan.operations.length} operações`);
  }

  console.log('\nPronto. Entre com:');
  console.log(`  e-mail: ${EMAIL}`);
  console.log(`  senha:  ${PASSWORD}`);
  console.log('\nO app mostra um torneio por aparelho: o mais recentemente atualizado (a Copa). Para ver outro, rode com --only=<nome> --reset e abra em uma janela anônima ou limpe os dados do site.');
  const pub = plans.filter((p) => p.publish).map((p) => `  ${API}/p/${p.slug}`);
  if (pub.length) console.log(`\nPáginas públicas:\n${pub.join('\n')}`);
}

main().catch((e) => {
  console.error(`\nERRO: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
