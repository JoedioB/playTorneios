import { canonicalJson } from '@playtorneios/domain';
import type { Command } from '@playtorneios/domain';
import { MemoryClientStorage, MemoryServerStore, SyncEngine, discardRejected, pullChanges, pushOperations, resolveConflictServer } from '../src/index.ts';
import type { Operation, PullResponse, PushResult, Transport } from '../src/index.ts';

export interface Faults {
  /** Probabilidade de a requisição se perder antes de chegar ao servidor. */
  dropRequest: number;
  /** Probabilidade de o servidor aplicar e a resposta se perder (o caso mais perigoso). */
  dropResponse: number;
  /** Probabilidade de entregar o lote duas vezes. */
  duplicate: number;
  offline: boolean;
}

export class FaultyTransport implements Transport {
  pushes = 0;
  store: MemoryServerStore;
  rng: () => number;
  faults: Faults;
  constructor(store: MemoryServerStore, rng: () => number, faults: Faults = { dropRequest: 0, dropResponse: 0, duplicate: 0, offline: false }) {
    this.store = store;
    this.rng = rng;
    this.faults = faults;
  }
  async push(ops: Operation[]): Promise<PushResult[]> {
    this.pushes++;
    if (this.faults.offline || this.rng() < this.faults.dropRequest) throw new Error('rede indisponível');
    const res = await pushOperations(this.store, ops, 'srv-now');
    if (this.rng() < this.faults.duplicate) await pushOperations(this.store, ops, 'srv-now');
    if (this.rng() < this.faults.dropResponse) throw new Error('resposta perdida');
    return res;
  }
  async health() {
    return !this.faults.offline;
  }
  async pull(tournamentId: string, since: number): Promise<PullResponse> {
    if (this.faults.offline) throw new Error('rede indisponível');
    return pullChanges(this.store, tournamentId, since);
  }
  async resolveServer(conflictId: string) {
    await resolveConflictServer(this.store, conflictId, 'srv-now');
  }
  async discardRejected(deviceId: string, key: string) {
    await discardRejected(this.store, deviceId, key);
  }
}

export function makeClient(store: MemoryServerStore, rng: () => number, id: string, faults?: Partial<Faults>) {
  let n = 0;
  let t = 0;
  const transport = new FaultyTransport(store, rng, { dropRequest: 0, dropResponse: 0, duplicate: 0, offline: false, ...faults });
  const storage = new MemoryClientStorage();
  const timers: Array<() => void> = [];
  const engine = new SyncEngine({
    storage,
    transport,
    newId: () => `${id}-${++n}`,
    now: () => new Date(Date.UTC(2026, 10, 1, 12, 0, 0) + ++t * 1000).toISOString(),
    rng,
    scheduler: { setTimeout: (fn) => { timers.push(fn); return () => undefined; } },
  });
  return { engine, transport, storage, timers };
}

export const T = 't1';

export function boot(): Command[] {
  return [
    { type: 'tournament.save', payload: { tournament: { id: T, organizationId: 'o', name: 'Open', organizationName: 'Org', startDate: '2026-11-07', endDate: '2026-11-08', city: 'Natal', venue: 'Praia', slug: 'open' } } },
    { type: 'court.save', payload: { court: { id: 'q1', name: 'Quadra 1' } } },
    { type: 'category.save', payload: { category: { id: 'c1', name: 'Aberta', format: 'single_elimination', formatConfig: {}, scoring: { model: 'sets', bestOf: 3, setPoints: 18, decidingSetPoints: 15, winBy: 2 }, groupScoring: { model: 'target', targetPoints: 18, winBy: 2 } } } },
  ];
}

export const serverCanon = (store: MemoryServerStore): string => canonicalJson(store.states.get(T));
export const clientCanon = (state: unknown): string => canonicalJson(state);
