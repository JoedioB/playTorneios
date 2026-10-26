import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio } from '../../../packages/domain/src/theme.ts';

const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + ' {');
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1] as string, m[2] as string]));
}

const themes: Array<[string, Record<string, string>]> = [
  ['escuro', tokens(':root')],
  ['claro (alto contraste)', { ...tokens(':root'), ...tokens(":root[data-contrast='light']") }],
];

for (const [name, t] of themes) {
  test(`contraste do tema ${name}: textos ≥ 4,5:1 e bordas/foco ≥ 3:1 (WCAG 1.4.3 e 1.4.11)`, () => {
    const fails: string[] = [];
    const check = (fg: string, bg: string, min: number) => {
      const r = contrastRatio(t[fg] as string, t[bg] as string);
      if (r < min) fails.push(`${fg} sobre ${bg}: ${r.toFixed(2)} < ${min}`);
    };
    for (const bg of ['bg', 'surf', 'surf2']) {
      for (const fg of ['tx', 'tx2', 'amber', 'live', 'ok', 'warn', 'err', 'info']) check(fg, bg, 4.5);
      check('line', bg, 3);
    }
    check('on-amber', 'amber', 4.5);
    check('on-live', 'live', 4.5);
    assert.deepEqual(fails, []);
  });
}
