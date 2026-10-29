import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { sha256 } from './auth.ts';
import { defaultExpiry } from './referee-core.ts';
import type { RefereeLink } from './referee-core.ts';

export interface RefereeLinkRow {
  id: string;
  tournamentId: string;
  courtId: string;
  courtName: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  active: boolean;
}

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

/** Cria o link. O token (256 bits) só existe nesta resposta; no banco fica o SHA-256. */
export async function createRefereeLink(
  pool: Pool,
  organizationId: string,
  tournamentId: string,
  input: { courtId: string; label?: string; validDays?: number },
  nowIso: string,
): Promise<{ token: string; link: RefereeLinkRow } | 'not_found' | 'court_not_found'> {
  const t = await pool.query(
    `select state->'courts'->$3->>'name' as court_name, state->'tournament'->>'endDate' as end_date
       from tournament_states where tournament_id = $1 and organization_id = $2`,
    [tournamentId, organizationId, input.courtId],
  );
  if (!t.rowCount) return 'not_found';
  const courtName = t.rows[0].court_name as string | null;
  if (!courtName) return 'court_not_found';
  const expiresAt = input.validDays ? new Date(new Date(nowIso).getTime() + input.validDays * 86_400_000).toISOString() : defaultExpiry(t.rows[0].end_date ?? undefined, nowIso);
  const token = randomBytes(32).toString('base64url');
  const label = (input.label ?? '').trim() || courtName;
  const r = await pool.query(
    `insert into referee_links (organization_id, tournament_id, court_id, token_hash, label, expires_at)
     values ($1, $2, $3, $4, $5, $6) returning id, created_at`,
    [organizationId, tournamentId, input.courtId, sha256(token), label, expiresAt],
  );
  return {
    token,
    link: { id: r.rows[0].id, tournamentId, courtId: input.courtId, courtName, label, createdAt: iso(r.rows[0].created_at) as string, expiresAt, revokedAt: null, lastSeenAt: null, active: true },
  };
}

export async function listRefereeLinks(pool: Pool, organizationId: string, tournamentId: string): Promise<RefereeLinkRow[]> {
  const r = await pool.query(
    `select l.id, l.tournament_id, l.court_id, l.label, l.created_at, l.expires_at, l.revoked_at, l.last_seen_at,
            ts.state->'courts'->l.court_id->>'name' as court_name
       from referee_links l join tournament_states ts on ts.tournament_id = l.tournament_id
      where l.organization_id = $1 and l.tournament_id = $2 order by l.created_at desc`,
    [organizationId, tournamentId],
  );
  return r.rows.map((x: any) => ({
    id: x.id,
    tournamentId: x.tournament_id,
    courtId: x.court_id,
    courtName: x.court_name ?? '(quadra removida)',
    label: x.label,
    createdAt: iso(x.created_at) as string,
    expiresAt: iso(x.expires_at) as string,
    revokedAt: iso(x.revoked_at),
    lastSeenAt: iso(x.last_seen_at),
    active: !x.revoked_at && new Date(x.expires_at) > new Date(),
  }));
}

export async function revokeRefereeLink(pool: Pool, organizationId: string, tournamentId: string, linkId: string): Promise<boolean> {
  const r = await pool.query(
    `update referee_links set revoked_at = coalesce(revoked_at, now()) where id = $1 and organization_id = $2 and tournament_id = $3`,
    [linkId, organizationId, tournamentId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Confere o token. Token inexistente, revogado ou vencido têm a mesma resposta (null). */
export async function authenticateReferee(pool: Pool, token: string | undefined): Promise<RefereeLink | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await pool.query(
    `update referee_links set last_seen_at = case when last_seen_at is null or last_seen_at < now() - interval '30 seconds' then now() else last_seen_at end
      where token_hash = $1 and revoked_at is null and expires_at > now()
      returning id, organization_id, tournament_id, court_id, label, expires_at`,
    [sha256(token)],
  );
  const x = r.rows[0];
  if (!x) return null;
  return { id: x.id, organizationId: x.organization_id, tournamentId: x.tournament_id, courtId: x.court_id, label: x.label, expiresAt: iso(x.expires_at) as string };
}
