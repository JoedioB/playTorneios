// Snapshot fictício para testar a página pública (formato de packages/domain/src/public-snapshot.ts).
// Os horários são relativos a `now`, para "ao vivo" e "próximos" fazerem sentido em qualquer dia.
import type { PublicCategory, PublicMatch, PublicSnapshot } from '@playtorneios/domain';

export const P = {
  a: 'Mateus Rodrigues Santos / Pedro Araújo Lima',
  b: 'Rodrigo Freitas Farias / Thiago Martins Freitas',
  c: 'Vinícius Mendes Carvalho / Alan Freitas Barros',
  d: 'Samuel Oliveira Rocha / Renato Farias Araújo',
  e: 'Camila Duarte Silva / Bia Monteiro Souza',
  f: 'Larissa Gomes Lima / Juliana Pereira Costa',
};

export type Variant = 'full' | 'single' | 'many' | 'empty' | 'closed' | 'no-schedule';

export function makeSnapshot(now: number, variant: Variant = 'full'): PublicSnapshot {
  const at = (min: number) => new Date(now + min * 60000).toISOString();
  const sch = variant !== 'no-schedule';
  const m = (id: string, label: string, phase: PublicMatch['phase'], a: string | null, b: string | null, status: PublicMatch['status'], extra: Partial<PublicMatch> = {}, min = 0): PublicMatch => ({
    id, label, phase, a, b, status, ...(sch ? { court: 'Quadra 2', scheduledAt: at(min) } : {}), ...extra,
  });
  const done = variant === 'closed';
  const catA: PublicCategory = {
    id: 'cat-a', name: 'Masculina Open',
    pairs: [P.a, P.b, P.c, P.d],
    groups: [{ name: 'Grupo A', rows: [{ pair: P.a, position: 1, played: 3, wins: 3 }, { pair: P.b, position: 2, played: 3, wins: 2 }, { pair: P.c, position: 3, played: 3, wins: 1 }, { pair: P.d, position: 4, played: 3, wins: 0 }] }],
    matches: [
      m('a-g1', 'Grupo A · rodada 1', 'group', P.a, P.d, 'finished', { score: { points: { a: 18, b: 11 } }, winner: 'a' }, -180),
      m('a-s1', 'Semifinal · jogo 1', 'knockout', P.a, P.c, 'finished', { score: { sets: [{ a: 18, b: 20 }, { a: 18, b: 8 }, { a: 15, b: 9 }] }, winner: 'a' }, -60),
      done
        ? m('a-s2', 'Semifinal · jogo 2', 'knockout', P.b, P.d, 'finished', { score: { sets: [{ a: 18, b: 11 }, { a: 18, b: 5 }] }, winner: 'a' }, -50)
        : m('a-s2', 'Semifinal · jogo 2', 'knockout', P.b, P.d, 'in_progress', { live: { a: 9, b: 7 } }, -10),
      done
        ? m('a-f', 'Final', 'knockout', P.a, P.b, 'finished', { score: { sets: [{ a: 18, b: 15 }, { a: 19, b: 17 }] }, winner: 'a' }, -20)
        : m('a-f', 'Final', 'knockout', P.a, null, 'not_started', {}, 90),
    ],
    ...(done ? { podium: { first: P.a, second: P.b, third: [P.c] } } : {}),
  };
  const catB: PublicCategory = {
    id: 'cat-b', name: 'Mista Iniciante',
    pairs: [P.e, P.f],
    matches: [m('b-f', 'Final', 'knockout', P.e, P.f, 'not_started', {}, 20)],
  };
  const empty: PublicCategory = { id: 'cat-a', name: 'Dupla Open', pairs: [], matches: [], groups: [] };
  const many = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(i % 2 ? catB : catA), id: `cat-${i}`, name: `Categoria de nome comprido número ${i + 1}`, matches: (i % 2 ? catB : catA).matches!.map((x) => ({ ...x, id: `${x.id}-${i}` })) }));
  const cats = variant === 'empty' ? [empty] : variant === 'single' ? [catA] : variant === 'many' ? many : [catA, catB];
  return {
    schemaVersion: 1,
    generatedAt: new Date(now - 40000).toISOString(),
    tournament: { name: 'Copa Teste de Futevôlei', organizationName: 'Liga Teste', startDate: '2026-11-07', endDate: '2026-11-08', city: 'Natal', venue: 'Praia de Ponta Negra', description: 'Dados fictícios.', slug: 'copa-teste', status: variant === 'empty' ? 'draft' : done ? 'closed' : 'open' },
    theme: { primary: '#FFB020', onPrimary: '#000000', accent: '#22D3EE', onAccent: '#000000', accentOnDark: '#22D3EE', accentOnLight: '#127281', adjusted: true },
    categories: cats,
  };
}
