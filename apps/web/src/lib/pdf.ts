import type { TournamentState } from '@playtorneios/domain';
import { categoryMatches, categoryOutcome, resolveCategory } from '@playtorneios/domain';
import { fmtDateTime, pairName, scoreText } from './format.ts';

/** PDF simples e legível (SPECS §12.2): cabeçalho, agenda por horário, resultados e pódio. */
export async function buildReportPdf(state: TournamentState): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 40;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const clean = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, '?');
  const line = (text: string, o: { size?: number; b?: boolean; gap?: number } = {}) => {
    const size = o.size ?? 10;
    if (y < M + size) { page = doc.addPage([W, H]); y = H - M; }
    page.drawText(clean(text).slice(0, 110), { x: M, y, size, font: o.b ? bold : font, color: rgb(0, 0, 0) });
    y -= size + (o.gap ?? 4);
  };
  const t = state.tournament;
  if (t?.theme.logoDataUrl?.startsWith('data:image/png')) {
    try {
      const img = await doc.embedPng(t.theme.logoDataUrl);
      const sc = Math.min(60 / img.height, 160 / img.width, 1);
      page.drawImage(img, { x: W - M - img.width * sc, y: H - M - img.height * sc + 8, width: img.width * sc, height: img.height * sc });
    } catch { /* logotipo inválido: segue sem ele */ }
  }
  line(t?.name ?? 'Torneio', { size: 18, b: true, gap: 6 });
  line(`${t?.organizationName ?? ''} - ${t?.city ?? ''} - ${t?.venue ?? ''}`, { size: 10, gap: 4 });
  const generated = fmtDateTime(new Date().toISOString());
  line(`Gerado em ${generated} (horario de Brasilia)`, { size: 9, gap: 14 });
  const scheduled = Object.values(state.matches).filter((m) => m.scheduledAt).sort((a, b) => (a.scheduledAt as string).localeCompare(b.scheduledAt as string));
  line('Agenda', { size: 14, b: true, gap: 8 });
  if (scheduled.length === 0) line('Nenhuma partida agendada.');
  for (const m of scheduled) {
    const res = resolveCategory(state, m.categoryId).matches[m.id];
    const a = res?.a.kind === 'pair' ? pairName(state, res.a.pairId) : 'A definir';
    const b = res?.b.kind === 'pair' ? pairName(state, res.b.pairId) : 'A definir';
    line(`${fmtDateTime(m.scheduledAt)}  ${state.courts[m.courtId ?? '']?.name ?? ''}  ${m.label}: ${a} x ${b}`);
  }
  y -= 10;
  for (const c of Object.values(state.categories).sort((x, y2) => x.name.localeCompare(y2.name))) {
    line(c.name, { size: 14, b: true, gap: 8 });
    const res = resolveCategory(state, c.id);
    for (const m of categoryMatches(state, c.id)) {
      const r = res.matches[m.id];
      if (!r?.result) continue;
      const a = r.a.kind === 'pair' ? pairName(state, r.a.pairId) : '?';
      const b = r.b.kind === 'pair' ? pairName(state, r.b.pairId) : '?';
      line(`${m.label}: ${a} x ${b}  ${r.result.kind === 'walkover' ? 'W.O.' : `${scoreText(r.result.sets, r.result.points)}${r.result.kind === 'retired' ? ' (abandono)' : ''}`}`);
    }
    const o = categoryOutcome(state, c.id, res);
    if (o.complete) {
      line(`Podio: 1o ${pairName(state, o.first)}; 2o ${pairName(state, o.second)}; 3o ${o.third.map((x) => pairName(state, x)).join(' e ')}`, { b: true, gap: 10 });
    }
    y -= 8;
  }
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(clean(`${t?.name ?? 'Torneio'} - gerado em ${generated} - pagina ${i + 1} de ${pages.length}`), { x: M, y: 20, size: 8, font, color: rgb(0.35, 0.35, 0.35) });
  });
  return doc.save();
}
