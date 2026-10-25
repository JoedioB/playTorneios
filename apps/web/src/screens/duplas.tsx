import { useMemo, useState } from 'react';
import { checkEligibility, normalizeSearch } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { REG_STATUS_LABEL, pairName, uuid } from '../lib/format.ts';
import { useRoute } from '../lib/router.ts';
import { Button, Dialog, Empty, Field, PageHead, StatusBadge } from '../ui/kit.tsx';

function AthleteForm(props: { label: string; value: { id: string; fullName: string; phone: string; birthDate: string; gender: string }; onChange: (v: any) => void; existing: Array<{ id: string; fullName: string }>; birthNeeded: boolean }) {
  const v = props.value;
  return (
    <fieldset className="card">
      <legend><h3>{props.label}</h3></legend>
      <div className="form-grid">
        <Field label="Atleta já cadastrado" hint="Escolha para reaproveitar, ou digite um novo ao lado.">
          {(p) => (
            <select {...p} value={props.existing.some((a) => a.id === v.id) ? v.id : ''} onChange={(e) => props.onChange(e.target.value ? { ...v, id: e.target.value, fullName: props.existing.find((a) => a.id === e.target.value)?.fullName ?? '' } : { ...v, id: uuid(), fullName: '' })}>
              <option value="">Novo atleta</option>
              {props.existing.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
            </select>
          )}
        </Field>
        <Field label="Nome completo">{(p) => <input {...p} value={v.fullName} onChange={(e) => props.onChange({ ...v, fullName: e.target.value })} />}</Field>
        <Field label="Telefone (opcional)">{(p) => <input {...p} inputMode="tel" value={v.phone} onChange={(e) => props.onChange({ ...v, phone: e.target.value })} />}</Field>
        <Field label="Gênero (opcional)">{(p) => <select {...p} value={v.gender} onChange={(e) => props.onChange({ ...v, gender: e.target.value })}><option value="">Não informar</option><option value="male">Masculino</option><option value="female">Feminino</option></select>}</Field>
        {props.birthNeeded && <Field label="Data de nascimento" hint="Pedida porque alguma categoria tem faixa etária.">{(p) => <input {...p} type="date" value={v.birthDate} onChange={(e) => props.onChange({ ...v, birthDate: e.target.value })} />}</Field>}
      </div>
    </fieldset>
  );
}

const blankAthlete = () => ({ id: uuid(), fullName: '', phone: '', birthDate: '', gender: '' });

export function DuplasScreen() {
  const { state, run } = useRuntime();
  const route = useRoute();
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(blankAthlete());
  const [b, setB] = useState(blankAthlete());
  const [display, setDisplay] = useState('');
  const [catId, setCatId] = useState('');
  const [err, setErr] = useState('');
  const [anon, setAnon] = useState<string | null>(null);
  const athletes = Object.values(state.athletes).filter((x) => !x.anonymizedAt).sort((x, y) => x.fullName.localeCompare(y.fullName));
  const birthNeeded = Object.values(state.categories).some((c) => c.ageRange && (c.ageRange.min !== undefined || c.ageRange.max !== undefined));
  const pairs = useMemo(() => {
    const n = normalizeSearch(q);
    return Object.values(state.pairs).filter((p) => !n || p.searchKey.includes(n)).sort((x, y) => pairName(state, x.id).localeCompare(pairName(state, y.id)));
  }, [state, q]);

  const create = async () => {
    setErr('');
    if (!a.fullName.trim() || !b.fullName.trim()) return setErr('Informe o nome dos dois atletas.');
    for (const x of [a, b]) {
      const patch = { id: x.id, fullName: x.fullName.trim(), phone: x.phone.trim() || undefined, birthDate: x.birthDate || undefined, gender: (x.gender || undefined) as 'male' | 'female' | undefined };
      if (!(await run({ type: 'athlete.save', payload: { athlete: patch } }))) return;
    }
    const pid = uuid();
    if (!(await run({ type: 'pair.save', payload: { pair: { id: pid, athleteAId: a.id, athleteBId: b.id, displayName: display.trim() || undefined } } }, 'Dupla criada.'))) return;
    if (catId) await run({ type: 'registration.create', payload: { registrationId: uuid(), categoryId: catId, pairId: pid } }, 'Inscrição criada como pendente.');
    setOpen(false); setA(blankAthlete()); setB(blankAthlete()); setDisplay(''); setCatId('');
  };

  return (
    <>
      <PageHead title="Atletas e duplas" actions={<Button variant="primary" icon="plus" onClick={() => setOpen(true)}>Nova dupla</Button>} />
      <Field label="Buscar dupla ou atleta">{(p) => <input {...p} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      {pairs.length === 0 ? <Empty title="Nenhuma dupla encontrada">Use “Nova dupla” para cadastrar.</Empty> : (
        <div className="scroll-x" role="region" aria-label="Lista de duplas" tabIndex={0} style={{ marginTop: '1rem' }}>
          <table>
            <caption className="sr-only">Duplas cadastradas</caption>
            <thead><tr><th scope="col">Dupla</th><th scope="col">Inscrições</th><th scope="col">Dados pessoais</th></tr></thead>
            <tbody>
              {pairs.map((p) => {
                const regs = Object.values(state.registrations).filter((r) => r.pairId === p.id);
                const ids = [p.athleteAId, p.athleteBId];
                return (
                  <tr key={p.id}>
                    <th scope="row">{pairName(state, p.id)}</th>
                    <td>{regs.length === 0 ? <span className="muted">Sem inscrição</span> : regs.map((r) => <div key={r.id} className="small">{state.categories[r.categoryId]?.name}: {REG_STATUS_LABEL[r.status]}</div>)}</td>
                    <td>
                      {ids.map((id) => state.athletes[id]).map((at) => at && (
                        <div key={at.id} className="row small">
                          {at.anonymizedAt ? <StatusBadge icon="lock" tone="mut">Anonimizado</StatusBadge> : <Button size="sm" variant="danger" label={`Anonimizar ${at.fullName}`} onClick={() => setAnon(at.id)}>Anonimizar {at.fullName.split(' ')[0]}</Button>}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} title="Nova dupla" onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" icon="check" onClick={() => void create()}>Criar dupla</Button></>}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          {err && <p className="error" role="alert">{err}</p>}
          <AthleteForm label="Atleta 1" value={a} onChange={setA} existing={athletes} birthNeeded={birthNeeded} />
          <AthleteForm label="Atleta 2" value={b} onChange={setB} existing={athletes} birthNeeded={birthNeeded} />
          <Field label="Nome de exibição da dupla (opcional)" hint="Aparece na página pública no lugar dos nomes completos.">{(p) => <input {...p} value={display} onChange={(e) => setDisplay(e.target.value)} />}</Field>
          <Field label="Inscrever já em uma categoria (opcional)">{(p) => <select {...p} value={catId} onChange={(e) => setCatId(e.target.value)}><option value="">Não inscrever agora</option>{Object.values(state.categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        </form>
      </Dialog>
      <Dialog open={!!anon} title="Anonimizar atleta" onClose={() => setAnon(null)} initialFocus="[data-safe]"
        footer={<><button className="btn" data-safe type="button" onClick={() => setAnon(null)}>Manter dados</button><Button variant="danger" onClick={() => { void run({ type: 'athlete.anonymize', payload: { athleteId: anon! } }, 'Atleta anonimizado.'); setAnon(null); }}>Anonimizar definitivamente</Button></>}>
        <p>Nome, telefone, nascimento e cidade serão removidos. Os resultados continuam, associados a “Atleta anonimizado”. <strong>Não dá para desfazer.</strong></p>
      </Dialog>
    </>
  );
}

export function InscricoesScreen() {
  const { state, run } = useRuntime();
  const [catId, setCatId] = useState('');
  const cats = Object.values(state.categories).sort((x, y) => x.name.localeCompare(y.name));
  const cid = catId || cats[0]?.id || '';
  const cat = state.categories[cid];
  const regs = Object.values(state.registrations).filter((r) => r.categoryId === cid).sort((x, y) => x.status.localeCompare(y.status) || pairName(state, x.pairId).localeCompare(pairName(state, y.pairId)));
  const badge = (s: string) => {
    switch (s) {
      case 'approved': return <StatusBadge icon="check" tone="ok">Aprovada</StatusBadge>;
      case 'canceled': return <StatusBadge icon="x" tone="mut" shape="dotted">Cancelada</StatusBadge>;
      case 'waitlist': return <StatusBadge icon="queue" tone="info" shape="dashed">Lista de espera</StatusBadge>;
      default: return <StatusBadge icon="clock" tone="warn" shape="dashed">Pendente</StatusBadge>;
    }
  };
  if (cats.length === 0) return (<><PageHead title="Inscrições e check-in" /><Empty title="Crie uma categoria primeiro"><a href="#/categorias">Ir para categorias</a></Empty></>);
  const approved = regs.filter((r) => r.status === 'approved').length;
  return (
    <>
      <PageHead title="Inscrições e check-in" sub={cat ? `${approved} aprovada(s)${cat.capacity ? ` de ${cat.capacity} vagas` : ''}` : undefined} />
      <Field label="Categoria">{(p) => <select {...p} value={cid} onChange={(e) => setCatId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
      {cat?.lockedAt && <p className="banner" style={{ marginTop: '1rem' }}>A chave desta categoria já foi gerada. Mudanças nas inscrições só valem depois de gerar a chave de novo.</p>}
      <div className="scroll-x" role="region" aria-label="Inscrições da categoria" tabIndex={0} style={{ marginTop: '1rem' }}>
        <table>
          <caption className="sr-only">Inscrições da categoria {cat?.name}</caption>
          <thead><tr><th scope="col">Dupla</th><th scope="col">Situação</th><th scope="col">Semente</th><th scope="col">Check-in</th><th scope="col">Ações</th></tr></thead>
          <tbody>
            {regs.length === 0 && <tr><td colSpan={5} className="muted">Nenhuma inscrição.</td></tr>}
            {regs.map((r) => {
              const p = state.pairs[r.pairId];
              const warns = p && cat ? checkEligibility([state.athletes[p.athleteAId], state.athletes[p.athleteBId]].filter(Boolean) as any, cat, state.tournament?.startDate ?? '') : [];
              return (
                <tr key={r.id}>
                  <th scope="row">{pairName(state, r.pairId)}{warns.map((w) => <div key={w.code + w.athleteId} className="small t-warn"><span aria-hidden="true">⚠ </span>{w.message}</div>)}</th>
                  <td>{badge(r.status)}{r.waitlistPosition ? <span className="small muted"> #{r.waitlistPosition}</span> : null}</td>
                  <td>
                    <label className="sr-only" htmlFor={`seed-${r.id}`}>Semente de {pairName(state, r.pairId)}</label>
                    <input id={`seed-${r.id}`} className="num" style={{ width: '5rem' }} type="number" min={1} defaultValue={r.seed ?? ''} onBlur={(e) => { const v = e.target.value; if ((v === '' ? undefined : Number(v)) !== r.seed) void run({ type: 'registration.setSeed', payload: { registrationId: r.id, seed: v === '' ? null : Number(v) } }); }} />
                  </td>
                  <td>
                    <label className="check"><input type="checkbox" checked={r.checkedInA} onChange={(e) => void run({ type: 'registration.checkIn', payload: { registrationId: r.id, side: 'a', value: e.target.checked } })} />Atleta 1</label>
                    <label className="check"><input type="checkbox" checked={r.checkedInB} onChange={(e) => void run({ type: 'registration.checkIn', payload: { registrationId: r.id, side: 'b', value: e.target.checked } })} />Atleta 2</label>
                  </td>
                  <td>
                    <div className="row">
                      {r.status !== 'approved' && r.status !== 'canceled' && <Button size="sm" icon="check" onClick={() => void run({ type: 'registration.setStatus', payload: { registrationId: r.id, status: 'approved' } })}>Aprovar</Button>}
                      {r.status !== 'canceled' && <Button size="sm" variant="danger" icon="x" onClick={() => void run({ type: 'registration.setStatus', payload: { registrationId: r.id, status: 'canceled' } })}>Cancelar</Button>}
                      {r.status === 'canceled' && <Button size="sm" onClick={() => void run({ type: 'registration.setStatus', payload: { registrationId: r.id, status: 'pending' } })}>Reabrir</Button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
