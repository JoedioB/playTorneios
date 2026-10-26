import { useMemo } from 'react';
import { buildPublicSnapshot, deriveTheme } from '@playtorneios/domain';
import { api } from '../data/http-transport.ts';
import { useRuntime } from '../data/runtime.tsx';
import { PublicView } from '../public/PublicView.tsx';
import { Button, PageHead, StatusBadge } from '../ui/kit.tsx';

export function PublicoScreen() {
  const { state, run, toast, sync, engine } = useRuntime();
  const t = state.tournament!;
  const s = t.publish;
  const preview = useMemo(() => buildPublicSnapshot({ ...state, tournament: { ...t, publish: { ...s, published: true } } }, new Date().toISOString()), [state, t, s]);
  const d = deriveTheme(t.theme.primary, t.theme.accent);
  const setPub = (patch: Partial<typeof s>) => run({ type: 'tournament.save', payload: { tournament: { id: t.id, publish: { ...s, ...patch } } } });
  const url = `${location.origin}/p/${t.slug}`;
  const pushNow = async () => {
    try { await engine.sync(); await api.post(`/api/tournaments/${encodeURIComponent(t.id)}/publish`); toast({ text: 'Página atualizada.', kind: 'ok' }); }
    catch { toast({ text: 'Sem conexão: a página pública será atualizada quando o servidor responder.', kind: 'info' }); }
  };
  return (
    <>
      <PageHead title="Página pública" sub={s.published ? <>Publicada em <a href={url}>{url}</a></> : 'Ainda não publicada. Nada sai do aparelho até você publicar.'}
        actions={s.published ? <Button variant="danger" onClick={() => void setPub({ published: false })}>Despublicar</Button> : <Button variant="primary" icon="globe" onClick={() => void setPub({ published: true })}>Publicar</Button>} />
      <div className="grid">
        <section className="card stack"><h2>O que aparece</h2>
          {(['pairs', 'brackets', 'schedule', 'results', 'podium'] as const).map((k) => (
            <label className="check" key={k}><input type="checkbox" checked={s.sections[k]} onChange={(e) => void setPub({ sections: { ...s.sections, [k]: e.target.checked } })} />
              {{ pairs: 'Lista de duplas', brackets: 'Chaves', schedule: 'Agenda (quadras e horários)', results: 'Resultados e classificação', podium: 'Pódio' }[k]}</label>
          ))}
          <label className="check"><input type="checkbox" checked={s.showDisplayNames} onChange={(e) => void setPub({ showDisplayNames: e.target.checked })} />Usar o nome de exibição da dupla quando existir</label>
          <label className="check"><input type="checkbox" checked={s.autoPublishOnSync} onChange={(e) => void setPub({ autoPublishOnSync: e.target.checked })} />Atualizar a página automaticamente a cada sincronização</label>
          <p className="small muted">Nunca aparecem: telefone, data de nascimento, cidade do atleta, histórico interno ou notas.</p>
          {s.published && <Button icon="sync" disabled={!sync.network} onClick={() => void pushNow()}>Atualizar agora</Button>}
        </section>
        <section className="card stack"><h2>Identidade visual</h2>
          <p>Cor de destaque na página pública: <strong>{d.accentOnLight}</strong>{d.accentOnLight !== d.accent ? ' (ajustada para manter o contraste)' : ''}.</p>
          <StatusBadge icon="check" tone="ok">Contraste conferido automaticamente</StatusBadge>
          <p className="small muted">Altere as cores em <a href="#/torneio">Dados do torneio</a>.</p></section>
      </div>
      <h2 style={{ marginTop: '1.5rem' }}>Pré-visualização</h2>
      <div className="card" style={{ background: '#fff', color: '#0a0e14' }} data-contrast="light">
        {preview ? <div className="preview-light" style={{ ['--bg' as string]: '#fff', ['--surf' as string]: '#f3f5f7', ['--tx' as string]: '#0a0e14', ['--tx2' as string]: '#3d4854', ['--hair' as string]: '#c3cbd4', ['--line' as string]: '#5a6572', color: '#0a0e14' }}><PublicView snapshot={preview} embedded /></div> : null}
      </div>
    </>
  );
}
