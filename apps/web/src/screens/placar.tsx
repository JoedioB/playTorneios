import { useState } from 'react';
import { DomainError, boardFromLive, boardToLive } from '@playtorneios/domain';
import type { Board, ScoreEntry } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { go } from '../lib/router.ts';
import { pairName, uuid } from '../lib/format.ts';
import { Scoreboard } from '../ui/scoreboard.tsx';
import { ToastRegion } from '../ui/kit.tsx';
import { ruleFor, useResolution } from './common.tsx';

/** Placar em tela cheia no aparelho do organizador (rota #/placar/<partida>). */
export function PlacarScreen(props: { matchId: string }) {
  const { state, run, engine, toast } = useRuntime();
  const m = state.matches[props.matchId];
  const res = useResolution(state, m?.categoryId);
  const [busy, setBusy] = useState(false);
  const back = () => go('/');
  if (!m) return <main id="conteudo" style={{ padding: '2rem' }}><h1>Partida não encontrada</h1><p><a href="#/">Voltar para a Central</a></p></main>;
  const rule = ruleFor(state, m);
  const rm = res?.matches[m.id];
  const aId = rm?.a.kind === 'pair' ? rm.a.pairId : undefined;
  const bId = rm?.b.kind === 'pair' ? rm.b.pairId : undefined;
  if (!rule || !aId || !bId) {
    return <main id="conteudo" style={{ padding: '2rem' }}><h1>{m.label}</h1><p>As duas duplas desta partida ainda não estão definidas.</p><p><a href="#/">Voltar para a Central</a></p></main>;
  }
  const finished = m.lifecycle === 'finished';
  const board = boardFromLive(m.live);
  const nameA = pairName(state, aId);
  const nameB = pairName(state, bId);
  const court = state.courts[m.courtId ?? '']?.name;

  const change = (next: Board) => { void run({ type: 'match.live_score', payload: { matchId: m.id, ...boardToLive(next) } }); };
  const finish = async (entry: ScoreEntry) => {
    setBusy(true);
    try {
      const r = await engine.dispatch({
        type: 'result.record',
        payload: { resultId: uuid(), matchId: m.id, kind: 'normal', sets: entry.sets, points: entry.points, expectedA: aId, expectedB: bId },
      });
      for (const w of r.warnings) toast({ text: w, kind: 'info' });
      toast({ text: 'Resultado registrado.', kind: 'ok' });
      back();
    } catch (e) {
      toast({ text: e instanceof DomainError ? e.message : 'Não foi possível registrar o resultado.', kind: 'err' });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Scoreboard
        rule={rule}
        nameA={nameA}
        nameB={nameB}
        board={board}
        title={m.label}
        subtitle={court}
        disabled={finished}
        busy={busy}
        onBoardChange={change}
        onFinish={(e) => void finish(e)}
        onExit={back}
        exitLabel="Voltar para a Central"
        notice={
          m.lifecycle === 'not_started' ? (
            <p className="banner" role="status">
              Partida ainda não iniciada.{' '}
              <button type="button" className="btn sm primary" onClick={() => void run({ type: 'match.start', payload: { matchId: m.id } }, 'Partida iniciada.')}>Iniciar partida</button>
            </p>
          ) : finished ? <p className="banner" role="status">Partida encerrada. Para corrigir, use Resultados.</p> : undefined
        }
      />
      <ToastRegion />
    </>
  );
}
