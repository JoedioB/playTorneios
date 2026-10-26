import type { TournamentState } from '@playtorneios/domain';
import type { ChangeEntry, ConflictRecord, PushResult, ServerStore, ServerTx } from '@playtorneios/sync';
import type { Pool, PoolClient } from 'pg';

type Client = PoolClient;

/**
 * Implementação PostgreSQL do armazenamento de sincronização. A operação e o registro de idempotência
 * ficam na MESMA transação SERIALIZABLE (SPECS §7.3); conflitos de serialização são repetidos.
 */
export class PgServerStore implements ServerStore {
  pool: Pool;
  /** Organização autenticada: toda leitura e escrita é restrita a ela. */
  currentOrg: string;

  constructor(pool: Pool, organizationId: string) {
    this.pool = pool;
    this.currentOrg = organizationId;
  }

  async transaction<T>(fn: (tx: ServerTx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query('begin isolation level serializable');
        const out = await fn(this.tx(client));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        if ((e as { code?: string }).code === '40001' && attempt < 8) {
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * (attempt + 1)));
          continue;
        }
        throw e;
      } finally {
        client.release();
      }
    }
  }

  private tx(c: Client): ServerTx {
    const org = this.currentOrg;
    return {
      async getState(tid) {
        const r = await c.query('select state from tournament_states where tournament_id = $1 and organization_id = $2', [tid, org]);
        return r.rows[0]?.state as TournamentState | undefined;
      },
      async putState(tid, state) {
        const other = await c.query('select 1 from tournament_states where tournament_id = $1 and organization_id <> $2', [tid, org]);
        if (other.rowCount) throw new Error('FORBIDDEN_TOURNAMENT');
        await c.query(
          `insert into tournament_states(tournament_id, organization_id, state) values ($1,$2,$3)
           on conflict (tournament_id) do update set state = excluded.state, updated_at = now()`,
          [tid, org, JSON.stringify(state)],
        );
        if (state.tournament) {
          // Slug já usado por outro torneio: acrescenta um sufixo estável em vez de falhar (que travaria a fila).
          const mine = await c.query('select slug from tournament_slugs where tournament_id = $1', [tid]);
          const wanted = state.tournament.slug;
          if (mine.rows[0]?.slug !== wanted) {
            const taken = await c.query('select tournament_id from tournament_slugs where slug = $1 and tournament_id <> $2', [wanted, tid]);
            const slug = taken.rowCount ? `${wanted}-${tid.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}` : wanted;
            await c.query(
              `insert into tournament_slugs(slug, tournament_id) values ($1,$2)
               on conflict (tournament_id) do update set slug = excluded.slug`,
              [slug, tid],
            );
          }
        }
      },
      async getApplied(d, o) {
        const r = await c.query('select result from applied_operations where device_id = $1 and op_id = $2', [d, o]);
        return r.rows[0]?.result as PushResult | undefined;
      },
      async putApplied(d, o, result, tournamentId) {
        await c.query(
          `insert into applied_operations(device_id, op_id, tournament_id, result) values ($1,$2,$3,$4)
           on conflict (device_id, op_id) do update set result = excluded.result`,
          [d, o, tournamentId ?? '', JSON.stringify(result)],
        );
      },
      async getVersion(k) {
        const r = await c.query('select version from entity_versions where key = $1', [k]);
        return (r.rows[0]?.version as number | undefined) ?? 0;
      },
      async bumpVersion(k, fields, deviceId) {
        const r = await c.query(
          `insert into entity_versions(key, version) values ($1, 1)
           on conflict (key) do update set version = entity_versions.version + 1 returning version`,
          [k],
        );
        const v = r.rows[0].version as number;
        await c.query('insert into entity_changes(key, version, fields, device_id) values ($1,$2,$3,$4)', [k, v, fields, deviceId]);
        return v;
      },
      async changesSince(k, version) {
        const r = await c.query('select version, fields, device_id from entity_changes where key = $1 and version > $2 order by version', [k, version]);
        return r.rows.map((x): ChangeEntry => ({ version: x.version, fields: x.fields, deviceId: x.device_id }));
      },
      async getHalt(d, k) {
        const r = await c.query('select op_id from sync_halts where device_id = $1 and key = $2', [d, k]);
        return r.rows[0]?.op_id as string | undefined;
      },
      async setHalt(d, k, o) {
        await c.query(
          `insert into sync_halts(device_id, key, op_id) values ($1,$2,$3)
           on conflict (device_id, key) do update set op_id = excluded.op_id`,
          [d, k, o],
        );
      },
      async clearHalt(d, k) {
        await c.query('delete from sync_halts where device_id = $1 and key = $2', [d, k]);
      },
      async getConflict(id) {
        const r = await c.query(
          `select c.record from sync_conflicts c join tournament_states t on t.tournament_id = c.tournament_id
           where c.id = $1 and t.organization_id = $2`,
          [id, org],
        );
        return r.rows[0]?.record as ConflictRecord | undefined;
      },
      async putConflict(x) {
        await c.query(
          `insert into sync_conflicts(id, tournament_id, entity_key, status, record) values ($1,$2,$3,$4,$5)
           on conflict (id) do update set status = excluded.status, record = excluded.record`,
          [x.id, x.tournamentId, x.entityKey, x.status, JSON.stringify(x)],
        );
      },
      async listConflicts(tid, status) {
        const r = await c.query(
          `select c.record from sync_conflicts c join tournament_states t on t.tournament_id = c.tournament_id
           where c.tournament_id = $1 and t.organization_id = $2 ${status ? "and c.status = 'open'" : ''} order by c.created_at`,
          [tid, org],
        );
        return r.rows.map((x) => x.record as ConflictRecord);
      },
      async nextCursor(tid) {
        const r = await c.query('update tournament_states set cursor = cursor + 1 where tournament_id = $1 and organization_id = $2 returning cursor', [tid, org]);
        return Number(r.rows[0]?.cursor ?? 0);
      },
      async getCursor(tid) {
        const r = await c.query('select cursor from tournament_states where tournament_id = $1 and organization_id = $2', [tid, org]);
        return Number(r.rows[0]?.cursor ?? 0);
      },
      async allVersions(tid) {
        const r = await c.query('select key, version from entity_versions where starts_with(key, $1)', [`${tid}/`]);
        return Object.fromEntries(r.rows.map((x) => [x.key as string, x.version as number]));
      },
    };
  }
}
