import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { TournamentState } from '@playtorneios/domain';
import type { ClientStorage, DiscardedOp, OutboxItem } from '@playtorneios/sync';

type Meta = { deviceId: string; seq: number; cursor: number; versions: Record<string, number> };

class PlayDb extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>;
  outbox!: Table<OutboxItem & { opId: string; seq: number }, string>;
  discarded!: Table<DiscardedOp & { id?: number }, number>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ kv: 'key', outbox: 'opId, seq', discarded: '++id' });
  }
}

/** Persistência local em IndexedDB (SPECS §5.4). Estado, fila e metadados sobrevivem a fechar o app. */
export class DexieStorage implements ClientStorage {
  db: PlayDb;
  constructor(name = 'playtorneios') {
    this.db = new PlayDb(name);
  }
  async loadState() {
    return (await this.db.kv.get('state'))?.value as TournamentState | undefined;
  }
  async saveState(s: TournamentState) {
    await this.db.kv.put({ key: 'state', value: s });
  }
  async loadOutbox() {
    const rows = await this.db.outbox.orderBy('seq').toArray();
    return rows.map(({ opId: _o, seq: _s, ...item }) => item as OutboxItem);
  }
  async saveOutboxItem(i: OutboxItem) {
    await this.db.outbox.put({ ...i, opId: i.op.opId, seq: i.op.seq });
  }
  async removeOutboxItem(opId: string) {
    await this.db.outbox.delete(opId);
  }
  async loadMeta() {
    return (await this.db.kv.get('meta'))?.value as Meta | undefined;
  }
  async saveMeta(m: Meta) {
    await this.db.kv.put({ key: 'meta', value: m });
  }
  /** Uma única transação IndexedDB: estado, meta e fila entram juntos ou não entram. */
  async commit(b: { state?: TournamentState; meta?: Meta; outboxPut?: OutboxItem[]; outboxRemove?: string[] }) {
    await this.db.transaction('rw', this.db.kv, this.db.outbox, async () => {
      if (b.state) await this.db.kv.put({ key: 'state', value: b.state });
      if (b.meta) await this.db.kv.put({ key: 'meta', value: b.meta });
      for (const id of b.outboxRemove ?? []) await this.db.outbox.delete(id);
      for (const i of b.outboxPut ?? []) await this.db.outbox.put({ ...i, opId: i.op.opId, seq: i.op.seq });
    });
  }
  async addDiscarded(d: DiscardedOp) {
    await this.db.discarded.add(d);
  }
  async listDiscarded() {
    return (await this.db.discarded.toArray()).map(({ id: _i, ...d }) => d as DiscardedOp);
  }
  async getPref<T>(key: string): Promise<T | undefined> {
    return (await this.db.kv.get(`pref:${key}`))?.value as T | undefined;
  }
  async setPref(key: string, value: unknown) {
    await this.db.kv.put({ key: `pref:${key}`, value });
  }
  /** Restauração de backup: troca todo o conteúdo local de uma vez. */
  async replaceAll(data: { state?: TournamentState; meta?: Meta; outbox: OutboxItem[]; discarded: DiscardedOp[] }) {
    await this.db.transaction('rw', this.db.kv, this.db.outbox, this.db.discarded, async () => {
      await this.db.kv.clear();
      await this.db.outbox.clear();
      await this.db.discarded.clear();
      if (data.state) await this.db.kv.put({ key: 'state', value: data.state });
      if (data.meta) await this.db.kv.put({ key: 'meta', value: data.meta });
      for (const i of data.outbox) await this.db.outbox.put({ ...i, opId: i.op.opId, seq: i.op.seq });
      for (const d of data.discarded) await this.db.discarded.add(d);
    });
  }
}
