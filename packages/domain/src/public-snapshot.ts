import { categoryOutcome, categoryMatches, resolveCategory } from './resolve.ts';
import type { Resolved } from './resolve.ts';
import { deriveTheme } from './theme.ts';
import type { DerivedTheme } from './theme.ts';
import type { Id, TournamentState } from './types.ts';

export interface PublicMatch {
  id: Id;
  label: string;
  phase: 'group' | 'knockout';
  a: string | null;
  b: string | null;
  court?: string;
  scheduledAt?: string;
  status: 'not_started' | 'in_progress' | 'finished';
  live?: { a: number; b: number };
  score?: { sets?: Array<{ a: number; b: number }>; points?: { a: number; b: number } };
  winner?: 'a' | 'b';
  walkover?: boolean;
  retired?: boolean;
}

export interface PublicCategory {
  id: Id;
  name: string;
  pairs?: string[];
  matches?: PublicMatch[];
  groups?: Array<{ name: string; rows: Array<{ pair: string; position: number; played: number; wins: number }> }>;
  podium?: { first?: string; second?: string; third: string[] };
}

export interface PublicSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  tournament: { name: string; organizationName: string; startDate: string; endDate: string; city: string; venue: string; description?: string; slug: string; status: string };
  theme: DerivedTheme;
  categories: PublicCategory[];
}

/**
 * Snapshot público por LISTA DE PERMISSÃO (SPECS §10.2): só os campos escritos aqui saem do servidor.
 * Telefone, data de nascimento, cidade do atleta, auditoria e notas internas nunca entram.
 */
export function buildPublicSnapshot(state: TournamentState, generatedAt: string): PublicSnapshot | null {
  const t = state.tournament;
  if (!t || !t.publish.published) return null;
  const sec = t.publish.sections;
  const nameOf = (pairId: Id | undefined): string | null => {
    if (!pairId) return null;
    const p = state.pairs[pairId];
    if (!p) return null;
    if (t.publish.showDisplayNames && p.displayName) return p.displayName;
    const a = state.athletes[p.athleteAId]?.fullName ?? '?';
    const b = state.athletes[p.athleteBId]?.fullName ?? '?';
    return `${a} / ${b}`;
  };
  const slotName = (r: Resolved | undefined): string | null => (r && r.kind === 'pair' ? nameOf(r.pairId) : null);

  const categories: PublicCategory[] = Object.values(state.categories)
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((c) => {
      const out: PublicCategory = { id: c.id, name: c.name };
      if (sec.pairs) {
        out.pairs = Object.values(state.registrations)
          .filter((r) => r.categoryId === c.id && r.status === 'approved')
          .map((r) => nameOf(r.pairId) as string)
          .sort();
      }
      const res = resolveCategory(state, c.id);
      if (sec.brackets || sec.schedule || sec.results) {
        out.matches = categoryMatches(state, c.id)
          .filter((m) => !res.matches[m.id]?.autoBye)
          .map((m) => {
            const rm = res.matches[m.id]!;
            const pm: PublicMatch = {
              id: m.id,
              label: m.label,
              phase: m.phase,
              a: slotName(rm.a),
              b: slotName(rm.b),
              status: m.lifecycle,
            };
            if (sec.schedule) {
              if (m.courtId) pm.court = state.courts[m.courtId]?.name;
              if (m.scheduledAt) pm.scheduledAt = m.scheduledAt;
            }
            if (m.lifecycle === 'in_progress' && m.live) pm.live = { a: m.live.a, b: m.live.b };
            if (sec.results && rm.result) {
              pm.score = { sets: rm.result.sets, points: rm.result.points };
              pm.winner = rm.result.winnerPairId === (rm.a.kind === 'pair' ? rm.a.pairId : '') ? 'a' : 'b';
              pm.walkover = rm.result.kind === 'walkover' || undefined;
              pm.retired = rm.result.kind === 'retired' || undefined;
            }
            return pm;
          });
      }
      if (sec.results) {
        out.groups = Object.entries(res.groups).flatMap(([gid, gs]) => {
          const def = state.brackets[c.id]?.groups?.find((g) => g.id === gid);
          if (!def) return [];
          return [{ name: def.name, rows: gs.rows.map((r) => ({ pair: nameOf(r.pairId) as string, position: r.position, played: r.played, wins: r.wins })) }];
        });
      }
      if (sec.podium) {
        const o = categoryOutcome(state, c.id, res);
        if (o.complete) out.podium = { first: nameOf(o.first) ?? undefined, second: nameOf(o.second) ?? undefined, third: o.third.map((x) => nameOf(x) as string) };
      }
      return out;
    });

  return {
    schemaVersion: 1,
    generatedAt,
    tournament: { name: t.name, organizationName: t.organizationName, startDate: t.startDate, endDate: t.endDate, city: t.city, venue: t.venue, description: t.description, slug: t.slug, status: t.status },
    theme: deriveTheme(t.theme.primary, t.theme.accent),
    categories,
  };
}
