import type { TournamentState } from '@playtorneios/domain';
import { pushOperations } from '@playtorneios/sync';
import type { Pool } from 'pg';
import { refreshSnapshot } from './app.ts';
import type { Config } from './config.ts';
import { PgServerStore } from './pg-store.ts';
import { athletesDue, closedAtOf, retentionOperations } from './retention-core.ts';

export interface RetentionReport {
  tournaments: number;
  athletes: number;
  details: Array<{ tournamentId: string; closedAt: string; athletes: number }>;
}

/**
 * Anonimiza os atletas de todo torneio encerrado há mais de `RETENTION_MONTHS` meses.
 * `dryRun` só conta. Seguro de repetir: as operações têm ids fixos e o que já foi anonimizado é ignorado.
 */
export async function runRetention(pool: Pool, config: Config, now: string = new Date().toISOString(), dryRun = false): Promise<RetentionReport> {
  const report: RetentionReport = { tournaments: 0, athletes: 0, details: [] };
  const months = config.RETENTION_MONTHS;
  if (months <= 0) return report;
  const rows = await pool.query(`select tournament_id, organization_id, state from tournament_states where state->'tournament'->>'status' = 'closed'`);
  for (const row of rows.rows as Array<{ tournament_id: string; organization_id: string; state: TournamentState }>) {
    const due = athletesDue(row.state, now, months);
    if (due.length === 0) continue;
    report.tournaments++;
    report.athletes += due.length;
    report.details.push({ tournamentId: row.tournament_id, closedAt: closedAtOf(row.state) ?? '', athletes: due.length });
    if (dryRun) continue;
    const results = await pushOperations(new PgServerStore(pool, row.organization_id), retentionOperations(row.state, row.tournament_id, now, months), now);
    const failed = results.filter((r) => r.status !== 'applied' && r.status !== 'duplicate');
    if (failed.length) throw new Error(`Retenção: ${failed.length} operação(ões) recusada(s) em ${row.tournament_id}: ${JSON.stringify(failed[0]?.error)}`);
    // Mesmos cuidados da anonimização manual: conflitos já resolvidos podem conter dados do atleta, e a página pública é refeita.
    await pool.query(`delete from sync_conflicts where tournament_id = $1 and status <> 'open'`, [row.tournament_id]);
    const st = row.state.tournament;
    if (st?.publish.published) await refreshSnapshot(pool, row.organization_id, row.tournament_id, now);
  }
  return report;
}
