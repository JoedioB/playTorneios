import { useState } from 'react';
import { describeRule, validateFormat } from '@playtorneios/domain';
import type { Category, ScoringRule, TiebreakerKey } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { FORMAT_LABEL, GENDER_LABEL, LEVEL_LABEL, uuid } from '../lib/format.ts';
import { Button, Dialog, Empty, Field, PageHead, StatusBadge } from '../ui/kit.tsx';

interface Form {
  id: string; name: string; level: string; gender: string; format: Category['format']; groups: string; advance: string;
  bestOf: string; setPoints: string; decidingPoints: string; groupTarget: string; groupCap: string;
  capacity: string; waitlist: boolean; third: boolean; ageMin: string; ageMax: string; wo: boolean; tb: TiebreakerKey[];
}

const TB_OPTIONS: Array<{ key: TiebreakerKey; label: string }> = [
  { key: 'head_to_head', label: 'Confronto direto' },
  { key: 'set_diff', label: 'Saldo de sets' },
  { key: 'point_diff', label: 'Saldo de pontos' },
  { key: 'points_for', label: 'Pontos feitos' },
];
const DEFAULT_TB: TiebreakerKey[] = ['head_to_head', 'set_diff', 'point_diff'];

const blank = (): Form => ({ id: uuid(), name: '', level: '', gender: '', format: 'single_elimination', groups: '2', advance: '2', bestOf: '3', setPoints: '18', decidingPoints: '15', groupTarget: '18', groupCap: '21', capacity: '', waitlist: false, third: false, ageMin: '', ageMax: '', wo: false, tb: DEFAULT_TB });

function fromCategory(c: Category): Form {
  const k = c.scoring;
  const g = c.groupScoring;
  return {
    id: c.id, name: c.name, level: c.level ?? '', gender: c.gender ?? '', format: c.format,
    groups: String(c.formatConfig.groups ?? 2), advance: String(c.formatConfig.advancePerGroup ?? 2),
    bestOf: k.model === 'sets' ? String(k.bestOf) : '3', setPoints: String(k.model === 'sets' ? k.setPoints : k.targetPoints), decidingPoints: String(k.model === 'sets' ? (k.decidingSetPoints ?? k.setPoints) : 15),
    groupTarget: String(g?.model === 'target' ? g.targetPoints : 18), groupCap: String(g?.model === 'target' ? (g.cap ?? '') : ''),
    capacity: c.capacity ? String(c.capacity) : '', waitlist: c.waitlistEnabled, third: c.thirdPlaceMatch,
    ageMin: c.ageRange?.min !== undefined ? String(c.ageRange.min) : '', ageMax: c.ageRange?.max !== undefined ? String(c.ageRange.max) : '', wo: c.woCredit !== 'none',
    tb: c.tiebreakers.filter((k) => TB_OPTIONS.some((o) => o.key === k)),
  };
}

function toScoring(f: Form): { scoring: ScoringRule; groupScoring: ScoringRule } {
  const setPts = Number(f.setPoints) || 18;
  return {
    scoring: { model: 'sets', bestOf: Number(f.bestOf) as 1 | 3 | 5, setPoints: setPts, decidingSetPoints: Number(f.decidingPoints) || undefined, winBy: 2 },
    groupScoring: { model: 'target', targetPoints: Number(f.groupTarget) || 18, winBy: 2, cap: f.groupCap ? Number(f.groupCap) : undefined },
  };
}

export function CategoriasScreen() {
  const { state, run } = useRuntime();
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const cats = Object.values(state.categories).sort((a, b) => a.name.localeCompare(b.name));
  const locked = !isNew && !!form && !!state.categories[form.id]?.lockedAt;
  const approved = (id: string) => Object.values(state.registrations).filter((r) => r.categoryId === id && r.status === 'approved').length;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((x) => (x ? { ...x, [k]: e.target.value } : x));

  const save = async () => {
    if (!form) return;
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Dê um nome à categoria.';
    if (form.format === 'groups_then_knockout') {
      const g = Number(form.groups), a = Number(form.advance);
      const v = validateFormat('groups_then_knockout', Math.max(approved(form.id), g * 3), { groups: g, advancePerGroup: a });
      if (g < 2 || a < 1) e.groups = 'Use ao menos 2 grupos e 1 classificado por grupo.';
      else if (a >= 3 && g * 3 > 0 && a > 2) e.advance = 'Classificar mais de 2 por grupo não é suportado nesta versão.';
      void v;
    }
    if (form.capacity && Number(form.capacity) < 2) e.capacity = 'A capacidade precisa ser de pelo menos 2 duplas.';
    setErr(e);
    if (Object.keys(e).length) return;
    const sc = toScoring(form);
    const patch: Partial<Category> & { id: string } = {
      id: form.id, name: form.name.trim(), level: (form.level || undefined) as Category['level'], gender: (form.gender || undefined) as Category['gender'],
      capacity: form.capacity ? Number(form.capacity) : undefined, waitlistEnabled: form.waitlist,
      ageRange: form.ageMin || form.ageMax ? { min: form.ageMin ? Number(form.ageMin) : undefined, max: form.ageMax ? Number(form.ageMax) : undefined } : undefined,
    };
    if (!locked) {
      Object.assign(patch, {
        format: form.format,
        formatConfig: form.format === 'groups_then_knockout' ? { groups: Number(form.groups), advancePerGroup: Number(form.advance) } : {},
        scoring: form.format === 'single_elimination' ? sc.scoring : sc.scoring,
        groupScoring: form.format === 'groups_then_knockout' ? sc.groupScoring : undefined,
        thirdPlaceMatch: form.third,
        tiebreakers: form.tb,
        woCredit: form.wo ? { winnerPoints: 18, loserPoints: 0 } : 'none',
      });
    }
    const r = await run({ type: 'category.save', payload: { category: patch } }, 'Categoria salva.');
    if (r) setForm(null);
  };

  return (
    <>
      <PageHead title="Categorias e regras" actions={<Button variant="primary" icon="plus" onClick={() => { setIsNew(true); setErr({}); setForm(blank()); }}>Nova categoria</Button>} />
      <p className="muted">Os padrões abaixo são do sistema (18 pontos, diferença de 2, teto de 21 na fase de grupos; melhor de 3 sets no mata-mata) e <strong>não são regulamento oficial</strong>. Ajuste conforme o seu torneio.</p>
      {cats.length === 0 ? <Empty title="Nenhuma categoria">Crie a primeira para abrir inscrições.</Empty> : (
        <div className="grid">
          {cats.map((c) => (
            <article className="card stack" key={c.id}>
              <h2>{c.name}</h2>
              <div className="row">
                {c.level && <StatusBadge icon="flag" tone="mut">{LEVEL_LABEL[c.level]}</StatusBadge>}
                {c.gender && <StatusBadge icon="users" tone="mut">{GENDER_LABEL[c.gender]}</StatusBadge>}
                {c.lockedAt && <StatusBadge icon="lock" tone="info">Regras congeladas</StatusBadge>}
              </div>
              <p className="small">{FORMAT_LABEL[c.format]}{c.format === 'groups_then_knockout' ? ` (${c.formatConfig.groups} grupos, ${c.formatConfig.advancePerGroup} avançam)` : ''}</p>
              <p className="small muted">Mata-mata: {describeRule(c.scoring)}.{c.groupScoring ? ` Grupos: ${describeRule(c.groupScoring)}.` : ''}</p>
              <p className="small">Aprovadas: <span className="num">{approved(c.id)}</span>{c.capacity ? ` de ${c.capacity}` : ''}</p>
              <div className="row">
                <Button size="sm" onClick={() => { setIsNew(false); setErr({}); setForm(fromCategory(c)); }}>Editar</Button>
                <Button size="sm" variant="danger" onClick={() => void run({ type: 'category.delete', payload: { categoryId: c.id } }, 'Categoria removida.')}>Remover</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog open={!!form} title={isNew ? 'Nova categoria' : 'Editar categoria'} onClose={() => setForm(null)}
        footer={<><Button onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" icon="check" onClick={() => void save()}>Salvar categoria</Button></>}>
        {form && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {locked && <p className="banner">A chave já foi gerada: formato e regras de pontuação não podem mais mudar. Nome e capacidade ainda podem.</p>}
            <Field label="Nome" error={err.name}>{(p) => <input {...p} value={form.name} onChange={set('name')} placeholder="Ex.: Masculino Intermediário" />}</Field>
            <div className="form-grid">
              <Field label="Nível">{(p) => <select {...p} value={form.level} onChange={set('level')}><option value="">Não definido</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
              <Field label="Gênero">{(p) => <select {...p} value={form.gender} onChange={set('gender')}><option value="">Não definido</option>{Object.entries(GENDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
              <Field label="Idade mínima" hint="Só peça data de nascimento se houver faixa etária.">{(p) => <input {...p} type="number" min={0} value={form.ageMin} onChange={set('ageMin')} />}</Field>
              <Field label="Idade máxima">{(p) => <input {...p} type="number" min={0} value={form.ageMax} onChange={set('ageMax')} />}</Field>
              <Field label="Capacidade (duplas)" error={err.capacity}>{(p) => <input {...p} type="number" min={2} value={form.capacity} onChange={set('capacity')} />}</Field>
              <Field label="Formato">{(p) => <select {...p} value={form.format} disabled={locked} onChange={set('format')}>{Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
              {form.format === 'groups_then_knockout' && (
                <>
                  <Field label="Quantidade de grupos" error={err.groups}>{(p) => <input {...p} type="number" min={2} disabled={locked} value={form.groups} onChange={set('groups')} />}</Field>
                  <Field label="Classificados por grupo" error={err.advance}>{(p) => <input {...p} type="number" min={1} max={2} disabled={locked} value={form.advance} onChange={set('advance')} />}</Field>
                </>
              )}
            </div>
            <fieldset className="card"><legend><h3>Pontuação</h3></legend>
              <div className="form-grid">
                <Field label="Mata-mata: melhor de">{(p) => <select {...p} disabled={locked} value={form.bestOf} onChange={set('bestOf')}><option value="1">1 set</option><option value="3">3 sets</option><option value="5">5 sets</option></select>}</Field>
                <Field label="Pontos do set">{(p) => <input {...p} type="number" min={1} disabled={locked} value={form.setPoints} onChange={set('setPoints')} />}</Field>
                <Field label="Pontos do set decisivo">{(p) => <input {...p} type="number" min={1} disabled={locked} value={form.decidingPoints} onChange={set('decidingPoints')} />}</Field>
                {form.format === 'groups_then_knockout' && (
                  <>
                    <Field label="Grupos: pontos da partida">{(p) => <input {...p} type="number" min={1} disabled={locked} value={form.groupTarget} onChange={set('groupTarget')} />}</Field>
                    <Field label="Grupos: teto de pontos" hint="Em branco = sem teto.">{(p) => <input {...p} type="number" min={1} disabled={locked} value={form.groupCap} onChange={set('groupCap')} />}</Field>
                  </>
                )}
              </div>
            </fieldset>
            {form.format === 'groups_then_knockout' && (
              <fieldset className="card"><legend><h3>Critérios de desempate (nesta ordem)</h3></legend>
                <p className="small muted">Vitórias vêm sempre primeiro. Se ainda houver empate, o organizador decide a ordem manualmente e o motivo fica registrado.</p>
                <ol className="stack" style={{ listStyle: 'none', padding: 0 }}>
                  {[...form.tb, ...TB_OPTIONS.map((o) => o.key).filter((k) => !form.tb.includes(k))].map((k) => {
                    const on = form.tb.includes(k);
                    const idx = form.tb.indexOf(k);
                    const label = TB_OPTIONS.find((o) => o.key === k)?.label ?? k;
                    const move = (d: -1 | 1) => setForm((x) => { if (!x) return x; const a = [...x.tb]; const j = idx + d; if (j < 0 || j >= a.length) return x; [a[idx], a[j]] = [a[j] as TiebreakerKey, a[idx] as TiebreakerKey]; return { ...x, tb: a }; });
                    return (
                      <li key={k} className="row">
                        <label className="check"><input type="checkbox" disabled={locked} checked={on} onChange={(e) => setForm((x) => x && { ...x, tb: e.target.checked ? [...x.tb, k] : x.tb.filter((y) => y !== k) })} />{label}{on ? ` (${idx + 1}º)` : ''}</label>
                        {on && <><Button size="sm" disabled={locked || idx === 0} label={`Subir ${label}`} onClick={() => move(-1)}>↑</Button><Button size="sm" disabled={locked || idx === form.tb.length - 1} label={`Descer ${label}`} onClick={() => move(1)}>↓</Button></>}
                      </li>
                    );
                  })}
                </ol>
              </fieldset>
            )}
            <label className="check"><input type="checkbox" checked={form.waitlist} onChange={(e) => setForm({ ...form, waitlist: e.target.checked })} />Usar lista de espera quando lotar</label>
            <label className="check"><input type="checkbox" disabled={locked} checked={form.third} onChange={(e) => setForm({ ...form, third: e.target.checked })} />Disputa de 3º lugar</label>
            {form.format === 'groups_then_knockout' && <label className="check"><input type="checkbox" disabled={locked} checked={form.wo} onChange={(e) => setForm({ ...form, wo: e.target.checked })} />Creditar 18 x 0 nos totais da fase de grupos em caso de W.O.</label>}
          </form>
        )}
      </Dialog>
    </>
  );
}
