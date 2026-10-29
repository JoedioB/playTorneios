/* global process, console, URL */
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
await build({
  entryPoints: { 'smoke-entry': fileURLToPath(new URL('./smoke-entry.tsx', import.meta.url)), 'smoke-public': fileURLToPath(new URL('../src/public/main.tsx', import.meta.url)) }, bundle: true, outdir: out, format: 'esm', jsx: 'automatic', target: 'es2022',
  loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning', sourcemap: 'inline',
});
writeFileSync(`${out}/index.html`, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><link rel="stylesheet" href="smoke-entry.css"></head><body><div id="root"></div><script type="module" src="smoke-entry.js"></script></body></html>');
// Página pública real (src/public/main.tsx): servida em /p/<slug>; a API é simulada pelo teste de navegador.
writeFileSync(`${out}/public.html`, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="description" content="Jogos, placares ao vivo, chaves e classificação do torneio."><meta name="theme-color" content="#0A0E14" media="(prefers-color-scheme: dark)"><title>Torneio — playTorneios</title><link rel="stylesheet" href="/smoke-public.css"></head><body><div id="root"></div><script type="module" src="/smoke-public.js"></script></body></html>');
console.log('ok');
