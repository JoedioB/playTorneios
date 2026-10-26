import { useMemo, useState } from 'react';
import { describeRule } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { fmtDateTime, pairName } from '../lib/format.ts';
import { Button, Empty, PageHead } from '../ui/kit.tsx';
import { ruleFor, useResolution } from './common.tsx';
import type { Match } from '@playtorneios/domain';

function Sheet({ m }: { m: Match }) {
  const { state } = useRuntime();
  const res = useResolution(state, m.categoryId);
  const rm = res?.matches[m.id];
  const rule = ruleFor(state, m);
  const name = (s: 'a' | 'b') => { const x = rm?.[s]; return x?.kind === 'pair' ? pairName(state, x.pairId) : '________________'; };
  const rows = rule?.model === 'sets' ? rule.bestOf : 1;
  return (
    <article className="sheet" aria-label={`Súmula ${m.label}`}>
      <h2>{state.tournament?.name} — Súmula</h2>
      <p>{state.categories[m.categoryId]?.name} · {m.label} · {state.courts[m.courtId ?? '']?.name ?? 'Quadra: ______'} · {m.scheduledAt ? fmtDateTime(m.scheduledAt) : 'Horário: ______'}</p>
      {rule && <p className="small">{describeRule(rule)}</p>}
      <table>
        <caption className="sr-only">Placar de {name('a')} contra {name('b')}</caption>
        <thead><tr><th scope="col">{rule?.model === 'sets' ? 'Set' : 'Placar'}</th><th scope="col">{name('a')}</th><th scope="col">{name('b')}</th></tr></thead>
        <tbody>{Array.from({ length: rows }, (_, i) => <tr key={i}><th scope="row">{rule?.model === 'sets' ? `${i + 1}º` : 'Final'}</th><td className="blank" /><td className="blank" /></tr>)}</tbody>
      </table>
      <p className="sign">Vencedor: ____________________ &nbsp; Juiz: ____________________ &nbsp; Hora do fim: ______</p>
    </article>
  );
}

/** Súmulas em papel (reserva para quando faltar sinal ou bateria) e lista por quadra. Use Imprimir do navegador. */
export function ImprimirScreen() {
  const { state } = useRuntime();
  const [courtId, setCourtId] = useState('');
  const courts = Object.values(state.courts).sort((a, b) => a.order - b.order);
  const matches = useMemo(() => Object.values(state.matches)
    .filter((m) => m.lifecycle !== 'finished' && (!courtId || m.courtId === courtId))
    .sort((x, y) => (x.scheduledAt ?? '9').localeCompare(y.scheduledAt ?? '9') || x.label.localeCompare(y.label)), [state.matches, courtId]);
  return (
    <>
      <PageHead title="Imprimir súmulas" sub="Folhas de papel para reserva na quadra. Só partidas ainda sem resultado."
        actions={<Button variant="primary" icon="download" onClick={() => window.print()}>Imprimir</Button>} />
      <div className="row no-print">
        <label>Quadra{' '}
          <select value={courtId} onChange={(e) => setCourtId(e.target.value)}>
            <option value="">Todas</option>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <span className="muted small">{matches.length} súmula(s)</span>
      </div>
      {matches.length === 0 ? <Empty title="Nada para imprimir">Todas as partidas já têm resultado.</Empty> : matches.map((m) => <Sheet key={m.id} m={m} />)}
    </>
  );
}
