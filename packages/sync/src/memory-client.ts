import type { TournamentState } from '@playtorneios/domain';
import type { ClientStorage, DiscardedOp, OutboxItem } from './client.ts';

type Meta = { deviceId: string; seq: number; cursor: number; versions: Record<string, number> };

/** Armazenamento do cliente em memória. Persiste entre "reinícios" simulados reaproveitando a mesma instância. */
export class MemoryClientStorage implements ClientStorage {
  state?: TournamentState;
  outbox = new Map<string, OutboxItem>();
  meta?: Meta;
  discarded: DiscardedOp[] = [];
  async loadState() {
    return this.state ? structuredClone(this.state) : undefined;
  }
  async saveState(s: TournamentState) {
    this.state = structuredClone(s);
  }
  async loadOutbox() {
    return [...this.outbox.values()].map((i) => structuredClone(i));
  }
  async saveOutboxItem(i: OutboxItem) {
    this.outbox.set(i.op.opId, structuredClone(i));
  }
  async removeOutboxItem(id: string) {
    this.outbox.delete(id);
  }
  async loadMeta() {
    return this.meta ? structuredClone(this.meta) : undefined;
  }
  async saveMeta(m: Meta) {
    this.meta = structuredClone(m);
  }
  async commit(b: { state?: TournamentState; meta?: Meta; outboxPut?: OutboxItem[]; outboxRemove?: string[] }) {
    if (b.state) this.state = structuredClone(b.state);
    if (b.meta) this.meta = structuredClone(b.meta);
    for (const id of b.outboxRemove ?? []) this.outbox.delete(id);
    for (const i of b.outboxPut ?? []) this.outbox.set(i.op.opId, structuredClone(i));
  }
  async addDiscarded(d: DiscardedOp) {
    this.discarded.push(structuredClone(d));
  }
  async listDiscarded() {
    return this.discarded.map((d) => structuredClone(d));
  }
}
