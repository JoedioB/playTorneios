import { useCallback, useEffect, useState } from 'react';
import { useRuntime } from '../data/runtime.tsx';
import { api, HttpError } from '../data/http-transport.ts';
import { fmtDateTime } from '../lib/format.ts';
import { qrSvgPath } from '../lib/qr.ts';
import { Button, Dialog, Empty, PageHead } from '../ui/kit.tsx';

interface LinkRow { id: string; courtId: string; courtName: string; label: string | null; createdAt: string; expiresAt: string; revokedAt: string | null; lastSeenAt: string | null; active: boolean }

function minutesAgo(iso: string | null): string {
  if (!iso) return 'nunca aberto';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'visto agora' : m < 60 ? `visto há ${m} min` : `visto há ${Math.round(m / 60)} h`;
}

export function JuizesScreen() {
  const { state, toast, session } = useRuntime();
  const tid = state.tournament?.id as string;
  const courts = Object.values(state.courts).sort((a, b) => a.order - b.order);
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [fresh, setFresh] = useState<{ url: string; court: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ links: LinkRow[] }>(`/api/tournaments/${encodeURIComponent(tid)}/referee-links`);
      setLinks(r.links);
    } catch { setLinks((l) => l ?? []); }
  }, [tid]);
  useEffect(() => { if (session) void load(); }, [load, session]);

  const create = async (courtId: string, courtName: string) => {
    setBusy(courtId);
    try {
      const r = await api.post<{ token: string }>(`/api/tournaments/${encodeURIComponent(tid)}/referee-links`, { courtId, label: (names[courtId] ?? '').trim() || courtName });
      setFresh({ url: `${location.origin}/juiz.html#${r.token}`, court: (names[courtId] ?? '').trim() ? `${courtName} — ${(names[courtId] ?? '').trim()}` : courtName });
      setNames((n) => ({ ...n, [courtId]: '' }));
      void load();
    } catch (e) {
      toast({ text: e instanceof HttpError && e.status === 400 ? 'Sincronize o torneio antes: o servidor ainda não conhece esta quadra.' : 'Não foi possível gerar o link. Verifique a conexão.', kind: 'err' });
    } finally { setBusy(null); }
  };
  const revoke = async (l: LinkRow) => {
    try {
      await api.del(`/api/tournaments/${encodeURIComponent(tid)}/referee-links/${l.id}`);
      toast({ text: `Link da ${l.courtName} revogado.`, kind: 'ok' });
      void load();
    } catch { toast({ text: 'Não foi possível revogar agora. Tente de novo.', kind: 'err' }); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast({ text: 'Link copiado.', kind: 'ok' }); } catch { toast({ text: 'Copie o link manualmente.', kind: 'info' }); }
  };
  const qr = fresh ? qrSvgPath(fresh.url) : null;

  return (
    <>
      <PageHead title="Links dos juízes" sub="Um link por juiz (gere vários na mesma quadra se houver revezamento). Quem abre o link lança os pontos daquela quadra, sem criar conta." />
      {!session && <p className="banner" role="status">Entre na sua conta para gerar links. Eles dependem do servidor.</p>}
      {courts.length === 0 ? <Empty title="Nenhuma quadra cadastrada">Cadastre as quadras para gerar um link por quadra.</Empty> : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {courts.map((c) => {
            const mine = (links ?? []).filter((l) => l.courtId === c.id && l.active);
            return (
              <li className="card stack" key={c.id}>
                <div className="row">
                  <strong>{c.name}</strong>
                  <label className="grow">Nome do juiz{' '}
                    <input value={names[c.id] ?? ''} maxLength={60} placeholder="Ex.: João" onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))} />
                  </label>
                  <Button size="sm" variant="primary" icon="plus" disabled={!session || busy === c.id} label={`Gerar link para ${(names[c.id] ?? '').trim() || 'um juiz'} na ${c.name}`} onClick={() => void create(c.id, c.name)}>Gerar link</Button>
                </div>
                {mine.length === 0 ? <p className="muted small">Nenhum link ativo.</p> : (
                  <ul style={{ listStyle: 'none', padding: 0 }} className="stack">
                    {mine.map((l) => (
                      <li className="row" key={l.id}>
                        <span className="grow small"><strong>{l.label}</strong> · criado {fmtDateTime(l.createdAt)} · vale até {fmtDateTime(l.expiresAt)} · {minutesAgo(l.lastSeenAt)}</span>
                        <Button size="sm" variant="danger" icon="x" label={`Revogar link de ${l.label} na ${c.name}`} onClick={() => void revoke(l)}>Revogar</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small" style={{ marginTop: '1rem' }}>
        O link é uma senha: quem o tiver pode lançar placares naquela quadra até ele vencer ou ser revogado. Compartilhe só com o juiz.
        O juiz não vê telefone nem dados de inscrição e não corrige resultados já registrados.
      </p>
      <Dialog open={!!fresh} title={`Link da ${fresh?.court ?? ''}`} onClose={() => setFresh(null)} footer={<Button variant="primary" icon="copy" onClick={() => void copy(fresh?.url ?? '')}>Copiar link</Button>}>
        <p>Mostre o QR code ao juiz ou envie o link. Ele aparece só agora; para ver de novo, gere outro.</p>
        {qr && (
          <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`QR code do link da ${fresh?.court}`} style={{ width: 'min(100%, 280px)', background: '#fff', display: 'block', margin: '0.5rem auto' }} shapeRendering="crispEdges">
            <path d={qr.d} fill="#000" />
          </svg>
        )}
        <input readOnly aria-label="Endereço do link" value={fresh?.url ?? ''} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
      </Dialog>
    </>
  );
}
