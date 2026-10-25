import { apply, emptyState } from '../src/index.ts';
import type { Command, TournamentState } from '../src/index.ts';

let n = 0;
export function run(state: TournamentState, cmd: Command, deviceId = 'dev1'): TournamentState {
  n++;
  return apply(state, cmd, { now: new Date(Date.UTC(2026, 10, 1, 12, 0, n)).toISOString(), deviceId, opId: `op${n}` }).state;
}

export function setup(opts: { pairs: number; format?: 'single_elimination' | 'groups_then_knockout'; groups?: number; advance?: number; third?: boolean }): TournamentState {
  let s = emptyState();
  s = run(s, {
    type: 'tournament.save',
    payload: { tournament: { id: 't1', organizationId: 'o1', name: 'Open', organizationName: 'Org', startDate: '2026-11-07', endDate: '2026-11-08', city: 'Natal', venue: 'Praia', slug: 'open' } },
  });
  s = run(s, { type: 'court.save', payload: { court: { id: 'q1', name: 'Quadra 1' } } });
  s = run(s, { type: 'court.save', payload: { court: { id: 'q2', name: 'Quadra 2' } } });
  const format = opts.format ?? 'single_elimination';
  s = run(s, {
    type: 'category.save',
    payload: {
      category: {
        id: 'c1',
        name: 'Aberta',
        format,
        formatConfig: format === 'groups_then_knockout' ? { groups: opts.groups, advancePerGroup: opts.advance } : {},
        scoring: { model: 'sets', bestOf: 3, setPoints: 18, decidingSetPoints: 15, winBy: 2 },
        groupScoring: { model: 'target', targetPoints: 18, winBy: 2, cap: 21 },
        thirdPlaceMatch: opts.third ?? false,
      },
    },
  });
  for (let i = 1; i <= opts.pairs; i++) {
    s = run(s, { type: 'athlete.save', payload: { athlete: { id: `a${i}`, fullName: `Atleta ${i}A` } } });
    s = run(s, { type: 'athlete.save', payload: { athlete: { id: `b${i}`, fullName: `Atleta ${i}B` } } });
    s = run(s, { type: 'pair.save', payload: { pair: { id: `p${i}`, athleteAId: `a${i}`, athleteBId: `b${i}` } } });
    s = run(s, { type: 'registration.create', payload: { registrationId: `r${i}`, categoryId: 'c1', pairId: `p${i}` } });
    s = run(s, { type: 'registration.setStatus', payload: { registrationId: `r${i}`, status: 'approved' } });
  }
  return s;
}
