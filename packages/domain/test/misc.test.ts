import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicSnapshot, computeGroupStandings, contrastRatio, deriveTheme, detectScheduleIssues, proposeSchedule, registrationsCsv, toCsv, validateScore, resolveCategory, findInvalidResults, mulberry32, categoryOutcome } from '../src/index.ts';
import type { Command } from '../src/index.ts';
import { run, setup } from './helpers.ts';

test('pontuação: 18 com diferença de 2 e teto 21', () => {
  const r = { model: 'target', targetPoints: 18, winBy: 2, cap: 21 } as const;
  assert.equal(validateScore(r, { points: { a: 18, b: 16 } }).length, 0);
  assert.equal(validateScore(r, { points: { a: 18, b: 17 } }).length, 1);
  assert.equal(validateScore(r, { points: { a: 20, b: 18 } }).length, 0);
  assert.equal(validateScore(r, { points: { a: 21, b: 20 } }).length, 0);
  assert.equal(validateScore(r, { points: { a: 17, b: 10 } }).length, 1);
});

test('classificação: confronto direto desempata três vias só com os jogos entre eles', () => {
  const g = (id: string, a: string, b: string, w: string, pa = 18, pb = 10) => ({ matchId: id, a, b, winner: w, setsA: w === a ? 1 : 0, setsB: w === b ? 1 : 0, pointsA: pa, pointsB: pb });
  // A>B, B>C, C>A, todos > D → empate triplo em 2 vitórias; saldo de pontos decide
  const games = [g('1', 'A', 'B', 'A', 18, 16), g('2', 'B', 'C', 'B', 18, 10), g('3', 'C', 'A', 'C', 18, 12), g('4', 'A', 'D', 'A'), g('5', 'B', 'D', 'B'), g('6', 'C', 'D', 'C')];
  const st = computeGroupStandings(['A', 'B', 'C', 'D'], games, ['head_to_head', 'point_diff']);
  assert.equal(st.rows[3]!.pairId, 'D');
  assert.equal(st.rows.slice(0, 3).some((r) => r.tieUnresolved), false);
  assert.equal(new Set(st.rows.map((r) => r.position)).size, 4);
});

test('empate irredutível fica em aberto até decisão manual', () => {
  const g = (id: string, a: string, b: string, w: string) => ({ matchId: id, a, b, winner: w, setsA: 1, setsB: 0, pointsA: 18, pointsB: 10 });
  const games = [g('1', 'A', 'B', 'A'), g('2', 'B', 'C', 'B'), g('3', 'C', 'A', 'C')];
  const open = computeGroupStandings(['A', 'B', 'C'], games, ['head_to_head', 'set_diff', 'point_diff']);
  assert.equal(open.unresolvedTies.length, 1);
  const decided = computeGroupStandings(['A', 'B', 'C'], games, ['head_to_head', 'set_diff', 'point_diff'], [
    { id: 't', tournamentId: 't1', categoryId: 'c', groupId: 'g', orderedPairIds: ['C', 'A', 'B'], reason: 'sorteio', resolvedAt: 'x' },
  ]);
  assert.deepEqual(decided.rows.map((r) => r.pairId), ['C', 'A', 'B']);
  assert.equal(decided.unresolvedTies.length, 0);
});

test('tema: cor do organizador nunca quebra o contraste', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 200; i++) {
    const hex = '#' + Array.from({ length: 3 }, () => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join('');
    const t = deriveTheme(hex, hex);
    assert.ok(contrastRatio(t.accentOnDark, '#0A0E14') >= 4.5, hex);
    assert.ok(contrastRatio(t.accentOnLight, '#FFFFFF') >= 4.5, hex);
    assert.ok(contrastRatio(t.primary, t.onPrimary) >= 4.5, hex);
  }
});

test('agenda proposta não tem conflitos', () => {
  let s = setup({ pairs: 8, format: 'groups_then_knockout', groups: 2, advance: 2, third: true });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 9 } });
  const a = proposeSchedule(s, { startAt: '2026-11-07T11:00:00.000Z', courtIds: ['q1', 'q2'] });
  s = run(s, { type: 'schedule.apply', payload: { assignments: a } });
  assert.ok(a.length > 0);
  assert.deepEqual(detectScheduleIssues(s), []);
});

test('agenda: conflito de quadra é recusado ao salvar e continua detectável', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const [m0, m1] = Object.values(s.matches).filter((m) => m.round === 1);
  s = run(s, { type: 'match.schedule', payload: { matchId: m0!.id, courtId: 'q1', scheduledAt: '2026-11-07T11:00:00.000Z' } });
  assert.throws(
    () => run(s, { type: 'match.schedule', payload: { matchId: m1!.id, courtId: 'q1', scheduledAt: '2026-11-07T11:10:00.000Z' } }),
    (e: any) => e.code === 'SCHEDULE_CONFLICT',
  );
  // Estados vindos de fora (ex.: servidor antigo) ainda são diagnosticados.
  s.matches[m1!.id] = { ...s.matches[m1!.id]!, courtId: 'q1', scheduledAt: '2026-11-07T11:10:00.000Z' };
  assert.equal(detectScheduleIssues(s).some((i) => i.code === 'COURT_OVERLAP'), true);
});

test('snapshot público: lista de permissão e nada de dados pessoais', () => {
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'athlete.save', payload: { athlete: { id: 'a1', phone: '84999990000', birthDate: '1990-05-05', city: 'Natal' } } });
  assert.equal(buildPublicSnapshot(s, 'x'), null, 'não publicado');
  s = run(s, { type: 'tournament.save', payload: { tournament: { id: 't1', publish: { ...s.tournament!.publish, published: true } } } });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 1 } });
  const snap = JSON.stringify(buildPublicSnapshot(s, 'x'));
  for (const secret of ['84999990000', '1990-05-05', 'organizationId', 'deviceId', 'audit', 'searchKey', 'phone', 'birthDate']) {
    assert.ok(!snap.includes(secret), `vazou: ${secret}`);
  }
  assert.ok(snap.includes('Atleta 1A'));
});

test('CSV: separador, BOM e proteção contra fórmulas', () => {
  const csv = toCsv(['A', 'B'], [['=cmd()', 'x;y'], ['ok', 'dizem "oi"']]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes("'=cmd()"));
  assert.ok(csv.includes('"x;y"'));
  assert.ok(csv.includes('"dizem ""oi"""'));
  const s = setup({ pairs: 2 });
  assert.ok(registrationsCsv(s).includes('Aprovada'));
});

// Propriedade: para qualquer N, gerar a chave e jogar tudo sempre produz um campeão e nunca deixa resultados obsoletos.
test('propriedade: torneios completos de 2..17 duplas terminam com pódio e sem inconsistências', () => {
  for (let n = 2; n <= 17; n++) {
    for (const seed of [1, 2, 3]) {
      let s = setup({ pairs: n, third: n >= 4 });
      s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed } });
      const rng = mulberry32(seed * 100 + n);
      for (let guard = 0; guard < 200; guard++) {
        const res = resolveCategory(s, 'c1');
        const next = Object.values(s.matches).find((m) => {
          const r = res.matches[m.id]!;
          return !r.autoBye && !r.result && r.a.kind === 'pair' && r.b.kind === 'pair';
        });
        if (!next) break;
        const w = rng() < 0.5 ? 'a' : 'b';
        const cmd: Command = {
          type: 'result.record',
          payload: { resultId: `rr${guard}`, matchId: next.id, kind: 'normal', sets: w === 'a' ? [{ a: 18, b: 5 }, { a: 18, b: 7 }] : [{ a: 5, b: 18 }, { a: 7, b: 18 }] },
        };
        s = run(s, cmd);
        assert.deepEqual(findInvalidResults(s, 'c1'), [], `n=${n}`);
      }
      const o = categoryOutcome(s, 'c1');
      assert.ok(o.first && o.second, `n=${n} seed=${seed} sem final`);
      assert.notEqual(o.first, o.second);
    }
  }
});

test('relatórios CSV: cabeçalho com torneio, categoria e data; sem fórmulas; pódio só com o que foi decidido', async () => {
  const { athletesPairsCsv, bracketCsv, scheduleCsv, resultsCsv, podiumCsv, registrationsReportCsv } = await import('../src/index.ts');
  let s = setup({ pairs: 4 });
  s = run(s, { type: 'tournament.save', payload: { tournament: { id: 't1', name: '=HYPERLINK("x")' } } });
  s = run(s, { type: 'bracket.generate', payload: { categoryId: 'c1', seed: 3 } });
  const at = '2026-11-07T15:30:00.000Z';
  const all = [athletesPairsCsv(s, at), bracketCsv(s, at), scheduleCsv(s, at), resultsCsv(s, at), podiumCsv(s, at), registrationsReportCsv(s, at)];
  for (const csv of all) {
    assert.ok(csv.startsWith('﻿'));
    assert.ok(csv.includes('Gerado em;07/11/2026 12:30'), 'data no fuso de Brasília');
    assert.ok(csv.includes("'=HYPERLINK"), 'nome do torneio neutralizado');
    assert.ok(!/(^|;)=HYPERLINK/m.test(csv));
  }
  assert.ok(podiumCsv(s, at).includes('Ainda não definido'));
  assert.ok(bracketCsv(s, at).includes('Final'));
});
