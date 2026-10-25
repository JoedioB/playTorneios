import { toCsv } from './csv.ts';
import { categoryOutcome, currentResult, resolveCategory } from './resolve.ts';
import type { Resolved } from './resolve.ts';
import type { Id, TournamentState } from './types.ts';

const TZ = 'America/Sao_Paulo';

export function formatDateTimeBR(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(', ', ' ');
}

export function pairName(state: TournamentState, pairId: Id | undefined): string {
  const p = pairId ? state.pairs[pairId] : undefined;
  if (!p) return '';
  if (p.displayName?.trim()) return p.displayName.trim();
  return `${state.athletes[p.athleteAId]?.fullName ?? '?'} / ${state.athletes[p.athleteBId]?.fullName ?? '?'}`;
}

function who(state: TournamentState, r: Resolved): string {
  return r.kind === 'pair' ? pairName(state, r.pairId) : r.kind === 'bye' ? 'Bye' : 'A definir';
}

/** Cabeçalho comum a todos os CSV: torneio, categoria e data/hora da geração (RF-17). */
function withHeader(state: TournamentState, title: string, categoryLabel: string, generatedAt: string, headers: string[], rows: unknown[][]): string {
  // Os campos do cabeçalho também passam pela proteção contra fórmulas (o nome do torneio é digitado).
  const BOM = '\ufeff';
  const head = toCsv(
    ['Relatório', title],
    [['Torneio', state.tournament?.name ?? ''], ['Categoria', categoryLabel], ['Gerado em', `${formatDateTimeBR(generatedAt)} (horário de Brasília)`], []],
  );
  return head + toCsv(headers, rows).slice(BOM.length);
}

function categoriesOf(state: TournamentState, categoryId?: Id): Id[] {
  return (categoryId ? [categoryId] : Object.keys(state.categories)).filter((id) => state.categories[id]).sort((a, b) => (state.categories[a]!.name).localeCompare(state.categories[b]!.name));
}
const catLabel = (state: TournamentState, categoryId?: Id): string => (categoryId ? (state.categories[categoryId]?.name ?? '') : 'Todas');

/** Atletas e duplas (inclui dados pessoais: uso interno da organização). */
export function athletesPairsCsv(state: TournamentState, generatedAt: string): string {
  const rows = Object.values(state.pairs)
    .sort((a, b) => pairName(state, a.id).localeCompare(pairName(state, b.id)))
    .map((p) => {
      const a = state.athletes[p.athleteAId];
      const b = state.athletes[p.athleteBId];
      const cats = Object.values(state.registrations).filter((r) => r.pairId === p.id && r.status !== 'canceled').map((r) => state.categories[r.categoryId]?.name).filter(Boolean).join(', ');
      return [pairName(state, p.id), a?.fullName, a?.phone, a?.city, b?.fullName, b?.phone, b?.city, cats];
    });
  return withHeader(state, 'Atletas e duplas (contém dados pessoais)', 'Todas', generatedAt, ['Dupla', 'Atleta A', 'Telefone A', 'Cidade A', 'Atleta B', 'Telefone B', 'Cidade B', 'Categorias'], rows);
}

/** Chaves e confrontos. */
export function bracketCsv(state: TournamentState, generatedAt: string, categoryId?: Id): string {
  const rows: unknown[][] = [];
  for (const cid of categoriesOf(state, categoryId)) {
    const res = resolveCategory(state, cid);
    const ms = Object.values(state.matches).filter((m) => m.categoryId === cid).sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'group' ? -1 : 1) || a.round - b.round || a.indexInRound - b.indexInRound);
    for (const m of ms) {
      const r = res.matches[m.id];
      rows.push([state.categories[cid]?.name, m.label, r ? who(state, r.a) : '', r ? who(state, r.b) : '']);
    }
  }
  return withHeader(state, 'Chaves e confrontos', catLabel(state, categoryId), generatedAt, ['Categoria', 'Partida', 'Dupla A', 'Dupla B'], rows);
}

/** Programação por quadra e horário. */
export function scheduleCsv(state: TournamentState, generatedAt: string, categoryId?: Id): string {
  const items: Array<{ at: string; row: unknown[] }> = [];
  const noTime: unknown[][] = [];
  for (const cid of categoriesOf(state, categoryId)) {
    const res = resolveCategory(state, cid);
    for (const m of Object.values(state.matches).filter((x) => x.categoryId === cid)) {
      const r = res.matches[m.id];
      if (r?.autoBye) continue;
      const court = m.courtId ? (state.courts[m.courtId]?.name ?? '') : '';
      const row = [m.scheduledAt ? formatDateTimeBR(m.scheduledAt) : 'Sem horário', court, state.categories[cid]?.name, m.label, r ? who(state, r.a) : '', r ? who(state, r.b) : ''];
      if (m.scheduledAt) items.push({ at: m.scheduledAt, row });
      else noTime.push(row);
    }
  }
  items.sort((a, b) => a.at.localeCompare(b.at) || String(a.row[1]).localeCompare(String(b.row[1])));
  return withHeader(state, 'Programação por quadra e horário', catLabel(state, categoryId), generatedAt, ['Horário', 'Quadra', 'Categoria', 'Partida', 'Dupla A', 'Dupla B'], [...items.map((i) => i.row), ...noTime]);
}

function scoreText(r: ReturnType<typeof currentResult>): string {
  if (!r) return '';
  if (r.sets?.length) return r.sets.map((s) => `${s.a}x${s.b}`).join(' ');
  if (r.points) return `${r.points.a}x${r.points.b}`;
  return '';
}
const KIND_PT: Record<string, string> = { normal: 'Normal', walkover: 'W.O.', retired: 'Abandono', pending: 'Pendente' };

/** Resultados das partidas e classificação dos grupos. */
export function resultsCsv(state: TournamentState, generatedAt: string, categoryId?: Id): string {
  const rows: unknown[][] = [];
  for (const cid of categoriesOf(state, categoryId)) {
    const res = resolveCategory(state, cid);
    const ms = Object.values(state.matches).filter((m) => m.categoryId === cid).sort((a, b) => a.round - b.round || a.indexInRound - b.indexInRound);
    for (const m of ms) {
      const r = res.matches[m.id];
      if (!r || r.autoBye) continue;
      const cur = r.result;
      rows.push([state.categories[cid]?.name, m.label, who(state, r.a), who(state, r.b), cur ? KIND_PT[cur.kind] : 'Sem resultado', scoreText(cur), cur ? pairName(state, cur.winnerPairId) : '']);
    }
    for (const [gid, g] of Object.entries(res.groups)) {
      for (const row of g.rows) {
        rows.push([state.categories[cid]?.name, `Classificação ${gid}`, `${row.position}º ${pairName(state, row.pairId)}`, '', `${row.wins}V ${row.losses}D`, `${row.pointsFor}-${row.pointsAgainst}`, row.tieUnresolved ? 'Empate em aberto' : '']);
      }
    }
  }
  return withHeader(state, 'Resultados e classificação', catLabel(state, categoryId), generatedAt, ['Categoria', 'Partida', 'Dupla A', 'Dupla B', 'Tipo', 'Placar', 'Vencedor'], rows);
}

/** Pódio por categoria; só mostra posições justificadas pelos resultados (RF-15). */
export function podiumCsv(state: TournamentState, generatedAt: string, categoryId?: Id): string {
  const rows: unknown[][] = [];
  for (const cid of categoriesOf(state, categoryId)) {
    const o = categoryOutcome(state, cid);
    const name = state.categories[cid]?.name;
    if (o.first) rows.push([name, '1º', pairName(state, o.first), o.complete ? 'Definido' : 'Parcial']);
    if (o.second) rows.push([name, '2º', pairName(state, o.second), o.complete ? 'Definido' : 'Parcial']);
    for (const t of o.third) rows.push([name, o.third.length > 1 ? '3º (empate)' : '3º', pairName(state, t), o.complete ? 'Definido' : 'Parcial']);
    if (!o.first) rows.push([name, '—', 'Ainda não definido', 'Em andamento']);
  }
  return withHeader(state, 'Pódio por categoria', catLabel(state, categoryId), generatedAt, ['Categoria', 'Posição', 'Dupla', 'Situação'], rows);
}

/** Lista de inscritos com cabeçalho (substitui registrationsCsv quando há data de geração). */
export function registrationsReportCsv(state: TournamentState, generatedAt: string, categoryId?: Id): string {
  const STATUS: Record<string, string> = { pending: 'Pendente', approved: 'Aprovada', canceled: 'Cancelada', waitlist: 'Lista de espera' };
  const rows = Object.values(state.registrations)
    .filter((r) => !categoryId || r.categoryId === categoryId)
    .sort((a, b) => (state.categories[a.categoryId]?.name ?? '').localeCompare(state.categories[b.categoryId]?.name ?? '') || a.id.localeCompare(b.id))
    .map((r) => [state.categories[r.categoryId]?.name, pairName(state, r.pairId), STATUS[r.status], r.seed ?? '', r.checkedInA ? 'Sim' : 'Não', r.checkedInB ? 'Sim' : 'Não']);
  return withHeader(state, 'Lista de inscritos', catLabel(state, categoryId), generatedAt, ['Categoria', 'Dupla', 'Situação', 'Semente', 'Presença A', 'Presença B'], rows);
}
