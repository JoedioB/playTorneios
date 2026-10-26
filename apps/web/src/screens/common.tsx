import { useMemo, useState } from 'react';
import { DomainError, resolveCategory, validateScore } from '@playtorneios/domain';
import type { ImpactReport, Match, ResultPayload, ScoringRule, TournamentState } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { LIFECYCLE_LABEL, RESULT_KIND_LABEL, pairName, uuid } from '../lib/format.ts';
import { Button, Dialog, Field, StatusBadge } from '../ui/kit.tsx';

export function useResolution(state: TournamentState, categoryId: string | undefined) {
  return useMemo(() => (categoryId && state.categories[categoryId] ? resolveCategory(state, categoryId) : null), [state, categoryId]);
}

export function ruleFor(state: TournamentState, m: Match): ScoringRule | undefined {
  const c = state.categories[m.categoryId];
  if (!c) return undefined;
  return m.phase === 'group' ? (c.groupScoring ?? c.scoring) : c.scoring;
}

export function MatchStatus({ m, kind }: { m: Match; kind?: string }) {
  if (kind === 'walkover') return <StatusBadge icon="flag" tone="info"><abbr title="Vitória por ausência do adversário">W.O.</abbr></StatusBadge>;
  if (kind === 'retired') return <StatusBadge icon="exit" tone="info">Abandono</StatusBadge>;
  if (m.lifecycle === 'finished') return <StatusBadge icon="check" tone="ok">{LIFECYCLE_LABEL.finished}</StatusBadge>;
  if (m.lifecycle === 'in_progress') return <StatusBadge icon="play" tone="live" shape="fill">{LIFECYCLE_LABEL.in_progress}</StatusBadge>;
  return <StatusBadge icon="calendar" tone="mut">{LIFECYCLE_LABEL.not_started}</StatusBadge>;
}

/** Confirmação de impacto. Foco inicial no botão seguro (manter), nunca no destrutivo (SPECS §11.3). */
export function ImpactDialog(props: { report: ImpactReport | null; title: string; confirmLabel: string; keepLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const r = props.report;
  return (
    <Dialog
      open={!!r}
      title={props.title}
      onClose={props.onCancel}
      initialFocus="[data-safe]"
      footer={
        <>
          <button className="btn" data-safe type="button" onClick={props.onCancel}>{props.keepLabel}</button>
          {r && !r.blocking && <Button variant="danger" onClick={props.onConfirm}>{props.confirmLabel}</Button>}
        </>
      }
    >
      {r && (
        <div className="stack">
          {r.blocking && <p className="error" role="alert">{r.blockingReason}</p>}
          {r.invalidated.length > 0 && (
            <section>
              <h3>Será invalidado</h3>
              <ul>{r.invalidated.map((i) => <li key={i.matchId}>{i.message}</li>)}</ul>
            </section>
          )}
          {r.lostSchedules.length > 0 && (
            <section>
              <h3>Muda de horário ou duplas</h3>
              <ul>{r.lostSchedules.map((i) => <li key={i.matchId}>{i.message}</li>)}</ul>
            </section>
          )}
          <section>
            <h3>Será preservado</h3>
            <p>{r.preserved.length} resultado(s) continuam valendo. Nada é apagado: resultados invalidados ficam no histórico.</p>
          </section>
        </div>
      )}
    </Dialog>
  );
}

type Row = { a: string; b: string };

/** Registro e correção de placar. Três toques: partida → pontos → confirmar (RNF-01). */
export function ScoreDialog(props: { matchId: string | null; onClose: () => void }) {
  const { state, engine, toast } = useRuntime();
  const m = props.matchId ? state.matches[props.matchId] : undefined;
  const res = useResolution(state, m?.categoryId);
  const rm = m && res ? res.matches[m.id] : undefined;
  const rule = m ? ruleFor(state, m) : undefined;
  const current = rm?.result;
  const rows = rule?.model === 'sets' ? rule.bestOf : 1;
  const [kind, setKind] = useState<'normal' | 'walkover' | 'retired'>('normal');
  const [vals, setVals] = useState<Row[]>([]);
  const [who, setWho] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [impact, setImpact] = useState<{ report: ImpactReport; payload: ResultPayload } | null>(null);
  const [initFor, setInitFor] = useState<string | null>(null);

  if (m && initFor !== m.id) {
    setInitFor(m.id);
    setKind(current && current.kind !== 'pending' ? (current.kind as 'normal' | 'walkover' | 'retired') : 'normal');
    const base: Row[] = Array.from({ length: rows }, () => ({ a: '', b: '' }));
    if (current?.sets) current.sets.forEach((s, i) => { if (base[i]) base[i] = { a: String(s.a), b: String(s.b) }; });
    else if (current?.points) base[0] = { a: String(current.points.a), b: String(current.points.b) };
    else if (m.live) base[0] = rule?.model === 'target' ? { a: String(m.live.a), b: String(m.live.b) } : base[0] as Row;
    setVals(base);
    setWho(current?.retiredPairId ?? current?.winnerPairId ?? '');
    setReason('');
    setTouched(false);
  }
  if (!m && initFor) setInitFor(null);

  const aId = rm?.a.kind === 'pair' ? rm.a.pairId : undefined;
  const bId = rm?.b.kind === 'pair' ? rm.b.pairId : undefined;
  const correction = !!current;

  const parsed = vals.map((v) => ({ a: Number(v.a), b: Number(v.b), empty: v.a === '' && v.b === '' }));
  const filled = parsed.filter((p) => !p.empty);
  const issues = useMemo(() => {
    if (!rule || kind !== 'normal') return [];
    return validateScore(rule, rule.model === 'sets' ? { sets: filled.map(({ a, b }) => ({ a, b })) } : { points: filled[0] ? { a: filled[0].a, b: filled[0].b } : undefined });
  }, [rule, kind, JSON.stringify(filled)]);
  const reasonOk = !correction || reason.trim().length >= 10;
  const whoOk = kind === 'normal' || who === aId || who === bId;
  const canSend = whoOk && reasonOk && (kind !== 'normal' || issues.length === 0);

  const buildPayload = (confirmToken?: string): ResultPayload => ({
    resultId: uuid(),
    matchId: m!.id,
    kind,
    sets: kind === 'normal' && rule?.model === 'sets' ? filled.map(({ a, b }) => ({ a, b })) : kind === 'retired' && rule?.model === 'sets' ? filled.map(({ a, b }) => ({ a, b })) : undefined,
    points: kind === 'normal' && rule?.model === 'target' && filled[0] ? { a: filled[0].a, b: filled[0].b } : undefined,
    winnerPairId: kind === 'walkover' ? who : undefined,
    retiredPairId: kind === 'retired' ? who : undefined,
    reason: reason.trim() || undefined,
    confirmToken,
    expectedA: aId,
    expectedB: bId,
  });

  const submit = async (payload: ResultPayload) => {
    try {
      const r = await engine.dispatch({ type: 'result.record', payload });
      toast({ text: correction ? 'Resultado corrigido. A versão anterior ficou no histórico.' : 'Resultado registrado.', kind: 'ok' });
      for (const w of r.warnings) toast({ text: w, kind: 'info' });
      setImpact(null);
      props.onClose();
    } catch (e) {
      if (e instanceof DomainError && e.code === 'IMPACT_CONFIRMATION_REQUIRED') {
        setImpact({ report: e.details as ImpactReport, payload });
        return;
      }
      toast({ text: e instanceof DomainError ? e.message : 'Não foi possível registrar.', kind: 'err' });
    }
  };

  const nameA = pairName(state, aId);
  const nameB = pairName(state, bId);
  return (
    <>
      <Dialog
        open={!!m && !impact}
        title={correction ? 'Corrigir resultado' : 'Registrar placar'}
        onClose={props.onClose}
        footer={
          <>
            <Button onClick={props.onClose}>Cancelar</Button>
            <Button variant="primary" icon="check" disabled={touched && !canSend} onClick={() => { setTouched(true); if (canSend) void submit(buildPayload()); }}>
              {correction ? 'Corrigir resultado' : 'Salvar resultado'}
            </Button>
          </>
        }
      >
        {m && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (canSend) void submit(buildPayload()); }}>
            <p><strong>{m.label}</strong><br />{nameA} <span className="muted">x</span> {nameB}</p>
            {!aId || !bId ? <p className="error" role="alert">As duplas desta partida ainda não estão definidas.</p> : null}
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="lbl" style={{ fontWeight: 600 }}>Tipo de resultado</legend>
              <div className="row">
                {(['normal', 'walkover', 'retired'] as const).map((k) => (
                  <label className="check" key={k}>
                    <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
                    {k === 'normal' ? 'Placar' : k === 'walkover' ? 'W.O. (ausência)' : 'Abandono'}
                  </label>
                ))}
              </div>
            </fieldset>
            {(kind === 'normal' || kind === 'retired') && rule && (
              <div className="stack">
                {vals.map((v, i) => (
                  <div className="row" key={i}>
                    <span className="muted" style={{ minWidth: '5rem' }}>{rule.model === 'sets' ? `Set ${i + 1}` : 'Pontos'}</span>
                    <Field label={`${nameA} — ${rule.model === 'sets' ? `set ${i + 1}` : 'pontos'}`}>
                      {(p) => <input {...p} className="num" inputMode="numeric" type="number" min={0} value={v.a} onChange={(e) => setVals((x) => x.map((r, j) => (j === i ? { ...r, a: e.target.value } : r)))} />}
                    </Field>
                    <Field label={`${nameB} — ${rule.model === 'sets' ? `set ${i + 1}` : 'pontos'}`}>
                      {(p) => <input {...p} className="num" inputMode="numeric" type="number" min={0} value={v.b} onChange={(e) => setVals((x) => x.map((r, j) => (j === i ? { ...r, b: e.target.value } : r)))} />}
                    </Field>
                  </div>
                ))}
                {kind === 'normal' && touched && issues.length > 0 && <p className="error" role="alert">{issues[0]!.message}</p>}
              </div>
            )}
            {kind !== 'normal' && (
              <Field label={kind === 'walkover' ? 'Quem venceu por W.O.?' : 'Quem desistiu?'} error={touched && !whoOk ? 'Escolha uma das duplas.' : undefined}>
                {(p) => (
                  <select {...p} value={who} onChange={(e) => setWho(e.target.value)}>
                    <option value="">Escolha…</option>
                    {aId && <option value={aId}>{nameA}</option>}
                    {bId && <option value={bId}>{nameB}</option>}
                  </select>
                )}
              </Field>
            )}
            {correction && (
              <Field label="Justificativa da correção" hint={`${reason.trim().length} de 10 caracteres no mínimo. Fica registrada na auditoria.`} error={touched && !reasonOk ? 'Explique o motivo da correção (mínimo de 10 caracteres).' : undefined}>
                {(p) => <textarea {...p} required value={reason} onChange={(e) => setReason(e.target.value)} />}
              </Field>
            )}
            {correction && current && <p className="muted small">Resultado atual: {current.kind === 'normal' ? (current.sets?.map((s) => `${s.a}x${s.b}`).join(' · ') ?? `${current.points?.a} x ${current.points?.b}`) : RESULT_KIND_LABEL[current.kind]}</p>}
          </form>
        )}
      </Dialog>
      <ImpactDialog
        report={impact?.report ?? null}
        title="Esta correção muda as partidas seguintes"
        keepLabel="Manter resultado atual"
        confirmLabel="Corrigir e invalidar o que depende"
        onCancel={() => setImpact(null)}
        onConfirm={() => impact && void submit({ ...impact.payload, resultId: uuid(), confirmToken: impact.report.token })}
      />
    </>
  );
}
