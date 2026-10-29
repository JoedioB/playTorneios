import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPoint, boardFromLive, boardResult, boardToLive, boardWinner, buildRefereeView, describeBoard, emptyBoard, removePoint, validateScore } from '../src/index.ts';
import type { Board, ScoringRule, Side } from '../src/index.ts';
import { run, setup } from './helpers.ts';

const target: ScoringRule = { model: 'target', targetPoints: 18, winBy: 2, cap: 21 };
const bo3: ScoringRule = { model: 'sets', bestOf: 3, setPoints: 18, decidingSetPoints: 15, winBy: 2 };

const play = (rule: ScoringRule, b: Board, seq: string): Board => [...seq].reduce((acc, c) => addPoint(rule, acc, c as Side), b);
const many = (side: Side, n: number) => side.repeat(n);

test('ponto único: 18 x 16 decide; 18 x 17 continua; teto de 21', () => {
  let b = play(target, emptyBoard(), many('a', 17) + many('b', 16));
  assert.equal(boardWinner(target, b), null);
  b = addPoint(target, b, 'a');
  assert.deepEqual([b.a, b.b], [18, 16]);
  assert.equal(boardWinner(target, b), 'a');
  // depois de decidida, novos pontos são ignorados
  assert.deepEqual(addPoint(target, b, 'b'), b);

  let c = play(target, emptyBoard(), many('a', 17) + many('b', 17));
  c = play(target, c, 'ab'.repeat(2)); // 19 x 19
  c = play(target, c, 'a');
  assert.equal(boardWinner(target, c), null); // 20 x 19
  c = play(target, c, 'b'); // 20 x 20
  c = play(target, c, 'a'); // 21 x 20 -> teto
  assert.equal(boardWinner(target, c), 'a');
  assert.equal(validateScore(target, boardResult(target, c)!).length, 0);
});

test('melhor de 3: o set fecha sozinho, o decisivo vai a 15 e o resultado valida', () => {
  let b = play(bo3, emptyBoard(), many('a', 18)); // 1º set 18 x 0
  assert.deepEqual(b.sets, [{ a: 18, b: 0 }]);
  assert.deepEqual([b.a, b.b], [0, 0]);
  b = play(bo3, b, many('b', 18)); // 2º set 0 x 18
  assert.equal(b.sets.length, 2);
  assert.equal(boardWinner(bo3, b), null);
  b = play(bo3, b, many('b', 14) + many('a', 14)); // 3º 14 x 14, ainda não acabou
  assert.equal(boardWinner(bo3, b), null);
  b = play(bo3, b, 'aa'); // 16 x 14 no decisivo (alvo 15, diferença 2)
  assert.equal(boardWinner(bo3, b), 'a');
  const res = boardResult(bo3, b)!;
  assert.equal(res.sets!.length, 3);
  assert.deepEqual(res.sets![2], { a: 16, b: 14 });
  assert.equal(validateScore(bo3, res).length, 0);
});

test('2 x 0 termina sem terceiro set', () => {
  const b = play(bo3, emptyBoard(), many('a', 18) + many('a', 18));
  assert.equal(boardWinner(bo3, b), 'a');
  assert.equal(boardResult(bo3, b)!.sets!.length, 2);
  assert.deepEqual(addPoint(bo3, b, 'b'), b);
});

test('desfazer: tira o ponto, e em 0 x 0 reabre o último set', () => {
  let b = play(bo3, emptyBoard(), 'aab');
  b = removePoint(bo3, b, 'b');
  assert.deepEqual([b.a, b.b], [2, 0]);
  assert.deepEqual(removePoint(bo3, emptyBoard(), 'a'), emptyBoard()); // nada a desfazer
  let c = play(bo3, emptyBoard(), many('a', 17) + many('b', 5) + 'a'); // fechou o 1º set 18 x 5
  assert.equal(c.sets.length, 1);
  c = removePoint(bo3, c, 'a'); // reabre: 17 x 5
  assert.equal(c.sets.length, 0);
  assert.deepEqual([c.a, c.b], [17, 5]);
  // desfazer depois de decidida volta a partida ao andamento (ponto único)
  const d = removePoint(target, play(target, emptyBoard(), many('a', 18)), 'a');
  assert.equal(boardWinner(target, d), null);
});

test('ida e volta com o placar ao vivo guardado na partida', () => {
  const b = play(bo3, emptyBoard(), many('a', 18) + 'bb');
  const live = boardToLive(b);
  assert.deepEqual(live, { a: 0, b: 2, sets: [{ a: 18, b: 0 }] });
  assert.deepEqual(boardFromLive(live), b);
  assert.deepEqual(boardToLive(emptyBoard()), { a: 0, b: 0 });
  assert.match(describeBoard(bo3, b, 'Ana', 'Bia'), /1º set 18 a 0; 2º set em andamento 0 a 2/);
});

test('domínio guarda sets ao vivo e a visão do juiz traz só o necessário', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const first = Object.values(s.matches).filter((m) => m.round === 1).sort((x, y) => x.indexInRound - y.indexInRound)[0]!;
  s = run(s, { type: 'match.schedule', payload: { matchId: first.id, courtId: 'q1', scheduledAt: '2026-11-07T09:00:00.000Z' } });
  s = run(s, { type: 'match.start', payload: { matchId: first.id } });
  s = run(s, { type: 'match.live_score', payload: { matchId: first.id, a: 3, b: 4, sets: [{ a: 18, b: 12 }] } });
  assert.deepEqual(s.matches[first.id]!.live!.sets, [{ a: 18, b: 12 }]);
  const view = buildRefereeView(s, 'q1')!;
  assert.equal(view.court.name, 'Quadra 1');
  assert.equal(view.matches.length, 1);
  const m = view.matches[0]!;
  assert.equal(m.status, 'in_progress');
  assert.equal(m.ready, true);
  assert.deepEqual(m.live, { a: 3, b: 4, sets: [{ a: 18, b: 12 }] });
  assert.equal(m.rule.model, 'sets');
  // nada pessoal: só nomes das duplas
  const text = JSON.stringify(view);
  for (const key of ['phone', 'birthDate', 'email', 'city']) assert.ok(!text.includes(`"${key}"`), key);
  assert.equal(buildRefereeView(s, 'q2')!.matches.length, 0);
  assert.equal(buildRefereeView(s, 'nao-existe'), null);
});
