// Retenção de dados pessoais (LGPD): anonimiza atletas de torneios encerrados há mais de N meses.
// Parte pura (sem banco), testável: decide quem anonimizar e monta as operações de sync.
import type { TournamentState } from '@playtorneios/domain';
import { SCHEMA_VERSION } from '@playtorneios/sync';
import type { Operation } from '@playtorneios/sync';

export const RETENTION_DEVICE = 'system-retention';

/** Quando o torneio foi encerrado: a última mudança para "encerrado" na trilha de auditoria; sem ela, o fim das datas do torneio. */
export function closedAtOf(state: TournamentState): string | undefined {
  const t = state.tournament;
  if (!t || t.status !== 'closed') return undefined;
  const closes = state.audit.filter((a) => a.action === 'tournament.status.closed').map((a) => a.at);
  if (closes.length) return closes.reduce((x, y) => (x > y ? x : y));
  return `${t.endDate}T23:59:59.000Z`;
}

/** Soma meses de calendário (31/jan + 1 mês = 28 ou 29/fev). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

/** Atletas que devem ser anonimizados agora. `months` 0 desliga a retenção. */
export function athletesDue(state: TournamentState, now: string, months: number): string[] {
  if (months <= 0) return [];
  const closedAt = closedAtOf(state);
  if (!closedAt || addMonths(closedAt, months) > now) return [];
  return Object.values(state.athletes).filter((a) => !a.anonymizedAt).map((a) => a.id).sort();
}

/** Operações idempotentes (mesmo id a cada rodada), enviadas pelo mesmo caminho de sync dos aparelhos. */
export function retentionOperations(state: TournamentState, tournamentId: string, now: string, months: number): Operation[] {
  return athletesDue(state, now, months).map((athleteId, i) => ({
    opId: `ret-${tournamentId}-${athleteId}`.slice(0, 128),
    deviceId: RETENTION_DEVICE,
    seq: i + 1,
    type: 'athlete.anonymize',
    entityType: 'athlete',
    entityId: athleteId,
    tournamentId,
    payload: { athleteId },
    clientCreatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  }));
}
