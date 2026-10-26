/* global process, console */
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('./smoke-entry.tsx', import.meta.url))], bundle: true, outdir: out, format: 'esm', jsx: 'automatic', target: 'es2022',
  loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning', sourcemap: 'inline',
});
writeFileSync(`${out}/index.html`, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><link rel="stylesheet" href="smoke-entry.css"></head><body><div id="root"></div><script type="module" src="smoke-entry.js"></script></body></html>');
console.log('ok');
