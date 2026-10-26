import { useState } from 'react';
import { contrastRatio, deriveTheme } from '@playtorneios/domain';
import type { Tournament } from '@playtorneios/domain';
import { useRuntime } from '../data/runtime.tsx';
import { uuid } from '../lib/format.ts';
import { resizeLogo } from '../lib/logo.ts';
import { Button, Field, PageHead } from '../ui/kit.tsx';
import { listKnown, openTournament } from '../lib/tournaments.ts';

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'torneio';
}

/** Primeiro uso: criar o torneio (RF-02). Funciona offline. */
export function Onboarding() {
  const { run, session } = useRuntime();
  const [f, setF] = useState({ name: '', organizationName: session?.email.split('@')[0] ?? '', city: '', venue: '', startDate: '', endDate: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Dê um nome ao torneio.';
    if (!f.startDate) e.startDate = 'Informe a data inicial.';
    if (!f.endDate) e.endDate = 'Informe a data final.';
    else if (f.endDate < f.startDate) e.endDate = 'A data final não pode ser anterior à inicial.';
    if (!f.city.trim()) e.city = 'Informe a cidade.';
    if (!f.venue.trim()) e.venue = 'Informe o local.';
    setErr(e);
    if (Object.keys(e).length) return;
    await run({ type: 'tournament.save', payload: { tournament: { id: uuid(), organizationId: session?.organizationId ?? 'local', ...f, name: f.name.trim(), slug: slugify(f.name) } } }, 'Torneio criado.');
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <main style={{ margin: '0 auto' }} id="conteudo">
      <h1>Criar torneio</h1>
      <p className="muted">Comece pelo básico. Você pode mudar tudo depois, mesmo sem internet.</p>
      {listKnown().length > 0 && (
        <p className="muted">Já tem torneio neste aparelho? {listKnown().map((k) => <Button key={k.id} size="sm" onClick={() => openTournament(k.id)}>{`Voltar para ${k.name}`}</Button>)}</p>
      )}
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Field label="Nome do torneio" error={err.name}>{(p) => <input {...p} value={f.name} onChange={set('name')} autoComplete="off" />}</Field>
        <Field label="Organização" error={err.organizationName}>{(p) => <input {...p} value={f.organizationName} onChange={set('organizationName')} />}</Field>
        <Field label="Cidade" error={err.city}>{(p) => <input {...p} value={f.city} onChange={set('city')} />}</Field>
        <Field label="Local (arena ou praia)" error={err.venue}>{(p) => <input {...p} value={f.venue} onChange={set('venue')} />}</Field>
        <Field label="Data inicial" error={err.startDate}>{(p) => <input {...p} type="date" value={f.startDate} onChange={set('startDate')} />}</Field>
        <Field label="Data final" error={err.endDate}>{(p) => <input {...p} type="date" value={f.endDate} onChange={set('endDate')} />}</Field>
        <div><Button type="submit" variant="primary" icon="check">Criar torneio</Button></div>
      </form>
    </main>
  );
}

export function TorneioScreen() {
  const { state, run, toast } = useRuntime();
  const t = state.tournament as Tournament;
  const [f, setF] = useState({ name: t.name, organizationName: t.organizationName, city: t.city, venue: t.venue, startDate: t.startDate, endDate: t.endDate, description: t.description ?? '', slug: t.slug, matchDurationMin: String(t.defaults.matchDurationMin), restMin: String(t.defaults.restMin), primary: t.theme.primary, accent: t.theme.accent, logo: t.theme.logoDataUrl ?? '' });
  const d = deriveTheme(f.primary, f.accent);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () =>
    run({
      type: 'tournament.save',
      payload: { tournament: { id: t.id, name: f.name.trim(), organizationName: f.organizationName.trim(), city: f.city.trim(), venue: f.venue.trim(), startDate: f.startDate, endDate: f.endDate, description: f.description.trim() || undefined, slug: f.slug, defaults: { matchDurationMin: Number(f.matchDurationMin), restMin: Number(f.restMin) }, theme: { ...t.theme, primary: f.primary, accent: f.accent, logoDataUrl: f.logo || undefined } } },
    }, 'Dados do torneio salvos.');
  return (
    <>
      <PageHead title="Dados do torneio" />
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="form-grid">
          <Field label="Nome">{(p) => <input {...p} value={f.name} onChange={set('name')} />}</Field>
          <Field label="Organização">{(p) => <input {...p} value={f.organizationName} onChange={set('organizationName')} />}</Field>
          <Field label="Cidade">{(p) => <input {...p} value={f.city} onChange={set('city')} />}</Field>
          <Field label="Local">{(p) => <input {...p} value={f.venue} onChange={set('venue')} />}</Field>
          <Field label="Data inicial">{(p) => <input {...p} type="date" value={f.startDate} onChange={set('startDate')} />}</Field>
          <Field label="Data final">{(p) => <input {...p} type="date" value={f.endDate} onChange={set('endDate')} />}</Field>
          <Field label="Endereço da página pública" hint="Só letras minúsculas, números e hífen.">{(p) => <input {...p} value={f.slug} onChange={set('slug')} pattern="[a-z0-9]+(-[a-z0-9]+)*" />}</Field>
          <Field label="Duração padrão da partida (min)" hint="Padrão do sistema: 40. Não é regulamento oficial.">{(p) => <input {...p} type="number" min={1} value={f.matchDurationMin} onChange={set('matchDurationMin')} />}</Field>
          <Field label="Descanso mínimo entre jogos (min)" hint="Padrão do sistema: 20.">{(p) => <input {...p} type="number" min={0} value={f.restMin} onChange={set('restMin')} />}</Field>
        </div>
        <Field label="Descrição">{(p) => <textarea {...p} value={f.description} onChange={set('description')} />}</Field>
        <fieldset className="card">
          <legend><h2>Identidade visual</h2></legend>
          <div className="form-grid">
            <Field label="Cor principal">{(p) => <input {...p} type="color" value={f.primary} onChange={set('primary')} />}</Field>
            <Field label="Cor de destaque">{(p) => <input {...p} type="color" value={f.accent} onChange={set('accent')} />}</Field>
          </div>
          <div className="stack">
            <Field label="Logotipo (opcional)" hint="PNG, JPEG ou WebP. É reduzido neste aparelho e aparece na página pública.">
              {(p) => <input {...p} type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try { const url = await resizeLogo(file); setF((x) => ({ ...x, logo: url })); }
                catch (err) { toast({ text: err instanceof Error ? err.message : 'Não foi possível usar esta imagem.', kind: 'err' }); }
              }} />}
            </Field>
            {f.logo && <div className="row"><img src={f.logo} alt="Prévia do logotipo" style={{ maxHeight: '4rem' }} /><button className="btn" type="button" onClick={() => setF((x) => ({ ...x, logo: '' }))}>Remover logotipo</button></div>}
          </div>
          <p className="small" role="status">
            Texto sobre a cor principal: {contrastRatio(d.primary, d.onPrimary).toFixed(1)}:1.{' '}
            {d.adjusted ? <>A cor de destaque foi <strong>ajustada para {d.accentOnDark}</strong> no tema escuro porque não alcançava contraste 4,5:1 sobre o fundo. Sua cor original continua guardada.</> : 'A cor de destaque tem contraste suficiente.'}
          </p>
        </fieldset>
        <Button type="submit" variant="primary" icon="check">Salvar dados</Button>
      </form>
    </>
  );
}
