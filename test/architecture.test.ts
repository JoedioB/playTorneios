// Regras de dependência (SPECS §3.1), verificadas lendo os imports reais do código.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => (m[1] ?? m[2]) as string);
}

const NODE_BUILTIN = /^node:/;
const rules: Array<{ dir: string; allowed: (spec: string) => boolean; why: string }> = [
  { dir: 'packages/domain/src', allowed: (s) => s.startsWith('.'), why: 'o domínio é TypeScript puro: só importa a si mesmo' },
  { dir: 'packages/sync/src', allowed: (s) => s.startsWith('.') || s === '@playtorneios/domain', why: 'sync depende apenas do domínio' },
  { dir: 'packages/contracts/src', allowed: (s) => s.startsWith('.') || s === 'zod' || s === '@playtorneios/domain', why: 'contratos dependem de zod e do domínio' },
  { dir: 'apps/api/src', allowed: (s) => s.startsWith('.') || NODE_BUILTIN.test(s) || !s.startsWith('@playtorneios/web'), why: 'a API não importa o front-end' },
  { dir: 'apps/web/src', allowed: (s) => !s.startsWith('@playtorneios/api') && !['pg', 'fastify', 'argon2'].includes(s), why: 'o front-end não importa a API nem bibliotecas de servidor' },
];

for (const r of rules) {
  test(`dependências: ${r.dir} — ${r.why}`, () => {
    const bad: string[] = [];
    for (const f of files(join(root, r.dir))) for (const s of imports(f)) if (!r.allowed(s)) bad.push(`${relative(root, f)} importa "${s}"`);
    assert.deepEqual(bad, []);
  });
}

test('domínio e sync não usam relógio nem aleatoriedade internos (funções puras)', () => {
  const bad: string[] = [];
  for (const dir of ['packages/domain/src']) {
    for (const f of files(join(root, dir))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/Math\.random\(|Date\.now\(|new Date\(\)/.test(code)) bad.push(relative(root, f));
    }
  }
  assert.deepEqual(bad, []);
});

test('o front-end não grava dados do torneio em localStorage (só preferências)', () => {
  const bad: string[] = [];
  for (const f of files(join(root, 'apps/web/src'))) {
    const code = readFileSync(f, 'utf8');
    for (const m of code.matchAll(/localStorage\.setItem\(\s*['"]([^'"]+)['"]/g)) if (!/^pt:(contrast|session|lock|fav)$/.test(m[1] as string)) bad.push(`${relative(root, f)}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});
