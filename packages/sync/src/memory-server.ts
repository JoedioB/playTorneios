import type { TournamentState } from '@playtorneios/domain';
import type { ServerStore, ServerTx } from './server.ts';
import type { ChangeEntry, ConflictRecord, PushResult } from './types.ts';

/** Armazenamento em memória, com transação por snapshot (rollback em caso de erro). Usado nos testes. */
export class MemoryServerStore implements ServerStore {
  states = new Map<string, TournamentState>();
  applied = new Map<string, PushResult>();
  versions = new Map<string, number>();
  changes = new Map<string, ChangeEntry[]>();
  halts = new Map<string, string>();
  conflicts = new Map<string, ConflictRecord>();
  cursors = new Map<string, number>();
  private chain: Promise<unknown> = Promise.resolve();

  private snapshot(): string {
    return JSON.stringify({
      states: [...this.states],
      applied: [...this.applied],
      versions: [...this.versions],
      changes: [...this.changes],
      halts: [...this.halts],
      conflicts: [...this.conflicts],
      cursors: [...this.cursors],
    });
  }

  private restore(json: string): void {
    const d = JSON.parse(json);
    this.states = new Map(d.states);
    this.applied = new Map(d.applied);
    this.versions = new Map(d.versions);
    this.changes = new Map(d.changes);
    this.halts = new Map(d.halts);
    this.conflicts = new Map(d.conflicts);
    this.cursors = new Map(d.cursors);
  }

  transaction<T>(fn: (tx: ServerTx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const snap = this.snapshot();
      try {
        return await fn(this.tx());
      } catch (e) {
        this.restore(snap);
        throw e;
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private tx(): ServerTx {
    const s = this;
    return {
      async getState(id) {
        const v = s.states.get(id);
        return v ? structuredClone(v) : undefined;
      },
      async putState(id, st) {
        s.states.set(id, structuredClone(st));
      },
      async getApplied(d, o) {
        const v = s.applied.get(`${d}:${o}`);
        return v ? structuredClone(v) : undefined;
      },
      async putApplied(d, o, r) {
        s.applied.set(`${d}:${o}`, structuredClone(r));
      },
      async getVersion(k) {
        return s.versions.get(k) ?? 0;
      },
      async bumpVersion(k, fields, deviceId) {
        const v = (s.versions.get(k) ?? 0) + 1;
        s.versions.set(k, v);
        const list = s.changes.get(k) ?? [];
        list.push({ version: v, fields, deviceId });
        s.changes.set(k, list);
        return v;
      },
      async changesSince(k, version) {
        return (s.changes.get(k) ?? []).filter((c) => c.version > version);
      },
      async getHalt(d, k) {
        return s.halts.get(`${d}|${k}`);
      },
      async setHalt(d, k, o) {
        s.halts.set(`${d}|${k}`, o);
      },
      async clearHalt(d, k) {
        s.halts.delete(`${d}|${k}`);
      },
      async getConflict(id) {
        const v = s.conflicts.get(id);
        return v ? structuredClone(v) : undefined;
      },
      async putConflict(c) {
        s.conflicts.set(c.id, structuredClone(c));
      },
      async listConflicts(tid, status) {
        return [...s.conflicts.values()].filter((c) => c.tournamentId === tid && (!status || c.status === status)).map((c) => structuredClone(c));
      },
      async nextCursor(tid) {
        const v = (s.cursors.get(tid) ?? 0) + 1;
        s.cursors.set(tid, v);
        return v;
      },
      async getCursor(tid) {
        return s.cursors.get(tid) ?? 0;
      },
      async allVersions(tid) {
        const out: Record<string, number> = {};
        for (const [k, v] of s.versions) if (k.startsWith(`${tid}/`)) out[k] = v;
        return out;
      },
    };
  }
}
