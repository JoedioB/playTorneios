import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvgPath } from '../src/lib/qr.ts';
import { enqueue } from '../src/juiz/queue.ts';
import type { QueuedCommand } from '../src/juiz/queue.ts';

const finder = (g: boolean[][], x0: number, y0: number) => {
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    const edge = i === 0 || j === 0 || i === 6 || j === 6;
    const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
    assert.equal(g[y0 + j]![x0 + i], edge || core);
  }
};

test('QR: tamanho por versão e marcadores de canto', () => {
  const small = qrMatrix('a'.repeat(10));
  assert.equal(small.length, 21);
  const url = qrMatrix(`https://torneios.exemplo.com.br/juiz.html#${'x'.repeat(43)}`);
  assert.ok(url.length >= 33 && url.length <= 45, `tamanho ${url.length}`);
  const n = url.length;
  finder(url, 0, 0); finder(url, n - 7, 0); finder(url, 0, n - 7);
  assert.throws(() => qrMatrix('a'.repeat(300)));
  const svg = qrSvgPath('abc');
  assert.equal(svg.size, 21 + 8);
  assert.ok(svg.d.startsWith('M'));
});

test('fila do juiz: só o último placar ao vivo de cada partida', () => {
  const live = (matchId: string, a: number): QueuedCommand => ({ opId: `${matchId}-${a}`, type: 'match.live_score', payload: { matchId, a, b: 0 } });
  let q: QueuedCommand[] = [{ opId: 's', type: 'match.start', payload: { matchId: 'm1' } }];
  for (let a = 1; a <= 5; a++) q = enqueue(q, live('m1', a));
  q = enqueue(q, live('m2', 3));
  assert.deepEqual(q.map((x) => x.opId), ['s', 'm1-5', 'm2-3']);
  const res: QueuedCommand = { opId: 'r', type: 'result.record', payload: { matchId: 'm1' } };
  assert.equal(enqueue(q, res).length, 4);
});
