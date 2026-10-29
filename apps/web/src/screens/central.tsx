import { useMemo, useState } from 'react';
import { detectScheduleIssues } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { fmtTime, pairName } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import { setupSteps } from '../lib/steps.ts';
import type { Step } from '../lib/steps.ts';
import { Button, PageHead, StatusBadge } from '../ui/kit.tsx';
import { MatchStatus, ScoreDialog, useResolution } from './common.tsx';

function AlertCard(props: { tone: 'warn' | 'err' | 'ok' | 'info'; count: number; label: string; to: string }) {
  return (
    <button type="button" className={`card alert-card ${props.tone}`} onClick={() => go(props.to)}>
      <span className="big">{props.count}</span>
      <span>{props.label}</span>
    </button>
  );
}

export function LiveCard(props: { matchId: string; onFinish: (id: string) => void }) {
  const { state, run } = useRuntime();
  const m = state.matches[props.matchId]!;
  const res = useResolution(state, m.categoryId);
  const rm = res?.matches[m.id];
  const a = rm?.a.kind === 'pair' ? rm.a.pairId : undefined;
  const b = rm?.b.kind === 'pair' ? rm.b.pairId : undefined;
  const live = m.live ?? { a: 0, b: 0, updatedAt: '' };
  const set = (na: number, nb: number) => run({ type: 'match.live_score', payload: { matchId: m.id, a: Math.max(0, na), b: Math.max(0, nb) } });
  return (
    <article className="card live-card" aria-label={`Partida em andamento: ${m.label}`}>
      <div className="row"><MatchStatus m={m} /><span className="muted small">{m.label} · {state.courts[m.courtId ?? '']?.name ?? 'sem quadra'}</span></div>
      {([['a', a, live.a], ['b', b, live.b]] as const).map(([side, pid, pts]) => (
        <div className="score-line" key={side}>
          <span className="grow">{pairName(state, pid)}</span>
          <span className="score" aria-live="off">{pts}</span>
          <Button className="plus" label={`Ponto para ${pairName(state, pid)}`} onClick={() => void set(side === 'a' ? live.a + 1 : live.a, side === 'b' ? live.b + 1 : live.b)}>+1</Button>
        </div>
      ))}
      <div className="row">
        <Button size="sm" icon="undo" onClick={() => void set(live.a > 0 ? live.a - 1 : 0, live.b)}>Desfazer ponto de A</Button>
        <Button size="sm" icon="undo" onClick={() => void set(live.a, live.b > 0 ? live.b - 1 : 0)}>Desfazer ponto de B</Button>
        <Button icon="play" onClick={() => go(`/placar/${m.id}`)}>Abrir placar</Button>
        <Button variant="primary" icon="check" onClick={() => props.onFinish(m.id)}>Finalizar partida</Button>
      </div>
    </article>
  );
}

function NextSteps(props: { steps: Step[]; next?: Step }) {
  return (
    <ol className="steps">
      {props.steps.map((s, i) => {
        const isNext = s === props.next;
        return (
          <li key={s.key} className={`step${isNext ? ' next' : ''}`} aria-current={isNext ? 'step' : undefined}>
            <span className="step-n num" aria-hidden="true">{i + 1}</span>
            <div className="grow">
              {isNext ? <strong>{s.title}</strong> : <a href={`#${s.to}`}><strong>{s.title}</strong></a>}
              {s.optional && <span className="muted small"> · no dia do evento</span>}
              <div className="small muted">{s.detail}</div>
            </div>
            {s.done ? <StatusBadge icon="check" tone="ok">Concluído</StatusBadge> : <StatusBadge icon="clock" tone="warn" shape="dashed">{isNext ? 'Próximo passo' : 'Pendente'}</StatusBadge>}
            {isNext && <a className="btn primary" href={`#${s.to}`}>{s.cta}</a>}
          </li>
        );
      })}
    </ol>
  );
}

export function CentralScreen() {
  const { state, run, toast } = useRuntime();
  const [scoreId, setScoreId] = useState<string | null>(null);
  const t = state.tournament!;
  const matches = Object.values(state.matches);
  const live = matches.filter((m) => m.lifecycle === 'in_progress');
  const issues = useMemo(() => detectScheduleIssues(state), [state]);
  const pendingReg = Object.values(state.registrations).filter((r) => r.status === 'pending').length;
  const cats = Object.values(state.categories);
  const full = cats.filter((c) => c.capacity !== undefined && Object.values(state.registrations).filter((r) => r.categoryId === c.id && r.status === 'approved').length >= c.capacity).length;
  const notDone = matches.filter((m) => m.lifecycle !== 'finished').length;
  const upcoming = matches
    .filter((m) => m.lifecycle === 'not_started' && m.scheduledAt)
    .sort((x, y) => (x.scheduledAt as string).localeCompare(y.scheduledAt as string))
    .slice(0, 5);
  const url = `${location.origin}/p/${t.slug}`;
  const steps = useMemo(() => setupSteps(state), [state]);
  const required = steps.filter((x) => !x.optional);
  const next = steps.find((x) => !x.done && !x.optional) ?? steps.find((x) => !x.done);
  const started = matches.some((m) => m.lifecycle !== 'not_started');
  const real = matches.filter((m) => m.slotA.kind !== 'bye' && m.slotB.kind !== 'bye');
  const allDone = real.length > 0 && real.every((m) => m.lifecycle === 'finished');
  const progress = `${required.filter((x) => x.done).length} de ${required.length} passos concluídos`;
  return (
    <>
      <PageHead title="Central" sub={`${t.name} · ${t.city}`} />
      {!started && (
        <section className="card stack" aria-labelledby="passos" style={{ marginBottom: '1.5rem' }}>
          <h2 id="passos">Preparação do torneio</h2>
          <p className="muted">{progress}. {next ? 'Siga a ordem sugerida abaixo.' : 'Tudo pronto: inicie a primeira partida na Agenda ou aqui, em Próximos jogos.'}</p>
          <NextSteps steps={steps} next={next} />
        </section>
      )}
      {allDone && t.status !== 'closed' && (
        <section className="card stack" aria-labelledby="fim" style={{ marginBottom: '1.5rem' }}>
          <h2 id="fim">Todas as partidas têm resultado</h2>
          <p className="muted">Confira o pódio, atualize a página pública e encerre o torneio.</p>
          <div className="row"><a className="btn" href="#/resultados">Ver pódio</a><a className="btn" href="#/publico">Página pública</a><a className="btn primary" href="#/encerramento">Encerrar torneio</a></div>
        </section>
      )}
      <section aria-label="Alertas" className="grid">
        <AlertCard tone={issues.length ? 'err' : 'ok'} count={issues.length} label="Conflitos de agenda" to="/agenda" />
        <AlertCard tone="warn" count={notDone} label="Partidas sem resultado" to="/resultados" />
        <AlertCard tone={pendingReg ? 'warn' : 'ok'} count={pendingReg} label="Inscrições a aprovar" to="/inscricoes" />
        <AlertCard tone="info" count={full} label="Categorias lotadas" to="/categorias" />
      </section>
      <section className="stack" style={{ marginTop: '1.5rem' }}>
        <h2>Em andamento</h2>
        {live.length === 0 ? <p className="muted">Nenhuma partida em andamento. Inicie uma na Agenda ou em Resultados.</p> : <div className="grid">{live.map((m) => <LiveCard key={m.id} matchId={m.id} onFinish={setScoreId} />)}</div>}
      </section>
      <section className="stack" style={{ marginTop: '1.5rem' }}>
        <h2>Próximos jogos</h2>
        {upcoming.length === 0 ? <p className="muted">Nenhum jogo agendado.</p> : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {upcoming.map((m) => (
              <li key={m.id} className="card row">
                <time className="num">{fmtTime(m.scheduledAt)}</time>
                <span className="grow">{m.label}</span>
                <span className="muted">{state.courts[m.courtId ?? '']?.name}</span>
                <Button size="sm" icon="play" onClick={() => void run({ type: 'match.start', payload: { matchId: m.id } }, 'Partida iniciada.')}>Iniciar</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card" style={{ marginTop: '1.5rem' }}>
        <h2>Página pública</h2>
        {t.publish.published ? <p>Endereço: <a href={url}>{url}</a></p> : <p className="muted">Ainda não publicada. Publique em <a href="#/publico">Página pública</a>.</p>}
        {t.publish.published && (
          <Button size="sm" icon="copy" onClick={async () => {
            try { await navigator.clipboard.writeText(url); toast({ text: 'Endereço copiado.', kind: 'ok' }); } catch { toast({ text: `Copie manualmente: ${url}`, kind: 'info' }); }
          }}>Copiar endereço</Button>
        )}
      </section>
      {started && (
        <details className="card" style={{ marginTop: '1.5rem' }}>
          <summary><strong>Preparação do torneio</strong> <span className="muted small">· {progress}</span></summary>
          <div style={{ marginTop: '0.75rem' }}><NextSteps steps={steps} next={next} /></div>
        </details>
      )}
      <ScoreDialog matchId={scoreId} onClose={() => setScoreId(null)} />
    </>
  );
}
