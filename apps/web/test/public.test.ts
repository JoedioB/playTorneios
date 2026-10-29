import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW_KEY, MAX_FOLLOWED, ago, announceDiff, categoryStatus, dateRange, knockoutRounds, liveMatches, matchesOfPair, matchesQuery, norm, pairNames,
  parseFollowed, clockSkew, scoreColumns, serializeFollowed, upcoming, hasContent, whenShort,
} from '../src/public/logic.ts';
import { P, makeSnapshot } from './public-fixture.ts';

const NOW = Date.parse('2026-11-07T15:00:00-03:00');

test('busca: ignora acento e caixa, aceita partes do nome em qualquer ordem, exige 2+ letras', () => {
  assert.equal(norm('  Vinícius  ÁLVARES '), 'vinicius alvares');
  assert.ok(matchesQuery(P.c, 'vinicius'));
  assert.ok(matchesQuery(P.c, 'ALAN barros'));
  assert.ok(matchesQuery(P.c, 'barros vin'));
  assert.ok(!matchesQuery(P.c, 'thiago'));
  assert.ok(!matchesQuery(P.c, 'v'), 'uma letra só não busca');
  assert.ok(!matchesQuery(P.c, '   '));
});

test('nomes de duplas: sem repetir, de jogos, classificação e lista', () => {
  const names = pairNames(makeSnapshot(NOW));
  assert.equal(new Set(names).size, names.length);
  for (const p of Object.values(P)) assert.ok(names.includes(p), p);
});

test('ao vivo e próximos: só jogos com as duas duplas definidas, por horário', () => {
  const s = makeSnapshot(NOW);
  assert.deepEqual(liveMatches(s).map((r) => r.m.id), ['a-s2']);
  assert.deepEqual(upcoming(s).map((r) => r.m.id), ['b-f'], 'a final de a (adversário a definir) não entra');
  const sem = makeSnapshot(NOW, 'no-schedule');
  assert.deepEqual(upcoming(sem).map((r) => r.m.id), ['b-f'], 'sem agenda publicada, usa a ordem original');
});

test('jogos de uma dupla: ao vivo, próximos, depois encerrados (o mais recente primeiro)', () => {
  const s = makeSnapshot(NOW);
  assert.deepEqual(matchesOfPair(s, P.a).map((r) => r.m.id), ['a-f', 'a-s1', 'a-g1']);
  assert.deepEqual(matchesOfPair(s, P.b).map((r) => r.m.id), ['a-s2']);
  assert.deepEqual(matchesOfPair(s, 'Ninguém'), []);
});

test('mata-mata agrupado por fase, na ordem do snapshot; fase de grupos fica de fora', () => {
  const r = knockoutRounds(makeSnapshot(NOW).categories[0]!.matches!);
  assert.deepEqual(r.map((x) => x.phase), ['Semifinal', 'Final']);
  assert.equal(r[0]!.matches.length, 2);
});

test('estado da categoria: vazia, aguardando, ao vivo, encerrada', () => {
  const s = makeSnapshot(NOW);
  assert.equal(categoryStatus(s.categories[0]!), 'live');
  assert.equal(categoryStatus(s.categories[1]!), 'waiting');
  assert.equal(categoryStatus(makeSnapshot(NOW, 'closed').categories[0]!), 'done');
  assert.equal(categoryStatus(makeSnapshot(NOW, 'empty').categories[0]!), 'empty');
  assert.equal(hasContent(makeSnapshot(NOW, 'empty')), false);
  assert.equal(hasContent(s), true);
});

test('colunas do placar: sets fechados, placar único, ao vivo (com e sem sets fechados), W.O.', () => {
  const s = makeSnapshot(NOW);
  const ms = s.categories[0]!.matches!;
  assert.deepEqual(scoreColumns(ms[1]!).map((c) => `${c.a}-${c.b}`), ['18-20', '18-8', '15-9']);
  assert.deepEqual(scoreColumns(ms[0]!).map((c) => `${c.a}-${c.b}`), ['18-11']);
  assert.deepEqual(scoreColumns(ms[2]!), [{ a: 9, b: 7, current: true }]);
  const withSets = { ...ms[2]!, live: { a: 3, b: 2, sets: [{ a: 18, b: 16 }] } };
  assert.deepEqual(scoreColumns(withSets as any), [{ a: 18, b: 16 }, { a: 3, b: 2, current: true }]);
  assert.deepEqual(scoreColumns({ ...ms[1]!, walkover: true }), []);
  assert.deepEqual(scoreColumns(ms[3]!), []);
});

test('anúncio para leitor de tela: só muda de estado e só de quem a pessoa segue', () => {
  const before = makeSnapshot(NOW);
  const after = makeSnapshot(NOW, 'closed');
  assert.deepEqual(announceDiff(before, after, []), [], 'sem favoritos: silêncio');
  assert.deepEqual(announceDiff(null, after, [P.a]), [], 'primeira carga: silêncio');
  const msgs = announceDiff(before, after, [P.a]);
  assert.equal(msgs.length, 1, 'a dupla A só tem a final mudando de estado (a semifinal dela já estava encerrada)');
  assert.match(msgs[0]!, /venceu/);
  assert.match(msgs[0]!, /18 a 15, 19 a 17/);
  const started = structuredClone(before);
  started.categories[1]!.matches![0]!.status = 'in_progress';
  assert.match(announceDiff(before, started, [P.e])[0]!, /Começou o jogo de .* contra /);
});

test('seguir: leitura tolerante a lixo, gravação por torneio, limite e remoção', () => {
  assert.deepEqual(parseFollowed(null, 'x'), []);
  assert.deepEqual(parseFollowed('isto não é json', 'x'), []);
  assert.deepEqual(parseFollowed('[1,2]', 'x'), []);
  assert.deepEqual(parseFollowed(JSON.stringify({ x: ['A / B', 3, '', 'C / D'] }), 'x'), ['A / B', 'C / D']);
  let raw = serializeFollowed(null, 'copa', ['A / B']);
  raw = serializeFollowed(raw, 'outra', ['Z / W']);
  assert.deepEqual(parseFollowed(raw, 'copa'), ['A / B']);
  assert.deepEqual(parseFollowed(raw, 'outra'), ['Z / W']);
  raw = serializeFollowed(raw, 'copa', []);
  assert.deepEqual(parseFollowed(raw, 'copa'), []);
  assert.ok(!('copa' in JSON.parse(raw)));
  const many = Array.from({ length: 20 }, (_, i) => `D${i}`);
  assert.equal(parseFollowed(serializeFollowed(null, 'x', many), 'x').length, MAX_FOLLOWED);
  assert.equal(FOLLOW_KEY, 'pt:fav');
  assert.ok(!/telefone|phone|birth/i.test(serializeFollowed(null, 'x', ['A / B'])));
});

test('textos: "há X", datas em Brasília, intervalo de datas', () => {
  assert.equal(ago(3000), 'agora');
  assert.equal(ago(40000), 'há 40 s');
  assert.equal(ago(5 * 60000), 'há 5 min');
  assert.equal(ago(2 * 3600000), 'há 2 h');
  assert.equal(ago(-9000), 'agora', 'relógio adiantado nunca vira "há -9 s"');
  assert.equal(whenShort('2026-11-07T18:31:00.000Z', NOW), '15:31');
  assert.match(whenShort('2026-11-08T18:31:00.000Z', NOW), /^dom,? 08\/11 15:31$/);
  assert.equal(dateRange('2026-11-07', '2026-11-08'), '7 a 8 de novembro de 2026');
  assert.equal(dateRange('2026-11-07', '2026-11-07'), '7 de novembro de 2026');
  assert.equal(dateRange('2026-10-30', '2026-11-02'), '30 de outubro de 2026 a 2 de novembro de 2026');
});

test('relógio do servidor: diferença pelo cabeçalho Date; ignora ausente, inválido e absurdo', () => {
  const local = Date.parse('2026-11-07T15:00:00Z');
  assert.equal(clockSkew('Sat, 07 Nov 2026 15:02:00 GMT', local), 120000, 'servidor 2 min à frente');
  assert.equal(clockSkew('Sat, 07 Nov 2026 14:59:00 GMT', local), -60000);
  assert.equal(clockSkew(null, local), 0);
  assert.equal(clockSkew('lixo', local), 0);
  assert.equal(clockSkew('Mon, 09 Nov 2026 15:00:00 GMT', local), 0, 'mais de 1 dia: descarta');
});
