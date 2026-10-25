import type { Match, ResultKind, TournamentState } from '@playtorneios/domain';

export const TZ = 'America/Sao_Paulo';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });

export const fmtDate = (iso: string | undefined): string => (iso ? dateFmt.format(new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso)) : '—');
export const fmtTime = (iso: string | undefined): string => (iso ? timeFmt.format(new Date(iso)) : '—');
export const fmtDay = (iso: string): string => dayFmt.format(new Date(iso));
export const fmtDateTime = (iso: string | undefined): string => (iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '—');

/** Brasil não tem horário de verão desde 2019: o fuso de Brasília é fixo em UTC−3. */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export const uuid = (): string => crypto.randomUUID();

export function pairName(state: TournamentState, pairId: string | undefined | null): string {
  if (!pairId) return 'A definir';
  const p = state.pairs[pairId];
  if (!p) return 'Dupla removida';
  if (p.displayName) return p.displayName;
  const a = state.athletes[p.athleteAId]?.fullName ?? '?';
  const b = state.athletes[p.athleteBId]?.fullName ?? '?';
  return `${a} / ${b}`;
}

export const LEVEL_LABEL: Record<string, string> = { beginner: 'Iniciante', intermediate: 'Intermediário', advanced: 'Avançado', open: 'Aberto' };
export const GENDER_LABEL: Record<string, string> = { male: 'Masculino', female: 'Feminino', mixed: 'Misto' };
export const FORMAT_LABEL: Record<string, string> = { single_elimination: 'Eliminação simples', groups_then_knockout: 'Grupos + mata-mata' };
export const REG_STATUS_LABEL: Record<string, string> = { pending: 'Pendente', approved: 'Aprovada', canceled: 'Cancelada', waitlist: 'Lista de espera' };
export const RESULT_KIND_LABEL: Record<ResultKind, string> = { normal: 'Normal', walkover: 'W.O.', retired: 'Abandono', pending: 'Pendente' };
export const LIFECYCLE_LABEL: Record<Match['lifecycle'], string> = { not_started: 'Agendada', in_progress: 'Em andamento', finished: 'Finalizada' };

export function scoreText(sets?: Array<{ a: number; b: number }>, points?: { a: number; b: number }): string {
  if (sets && sets.length) return sets.map((s) => `${s.a}x${s.b}`).join(' · ');
  if (points) return `${points.a} x ${points.b}`;
  return '';
}
