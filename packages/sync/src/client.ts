import { apply, commandTarget, DomainError, emptyState } from '@playtorneios/domain';
import type { Command, TournamentState } from '@playtorneios/domain';
import { entityKey, SCHEMA_VERSION } from './types.ts';
import type { ConflictRecord, Operation, PullResponse, PushResult } from './types.ts';

export type OutboxStatus = 'pending' | 'inflight' | 'rejected' | 'conflict' | 'blocked';

export interface OutboxItem {
  op: Operation;
  status: OutboxStatus;
  attempts: number;
  error?: { code: string; message: string; details?: unknown };
  conflictId?: string;
}

export interface DiscardedOp {
  op: Operation;
  reason: 'server_kept' | 'user_discarded';
  at: string;
}

/** Persistência local (IndexedDB em produção; memória nos testes). Cada método é atômico por si só. */
export interface ClientStorage {
  loadState(): Promise<TournamentState | undefined>;
  saveState(state: TournamentState): Promise<void>;
  loadOutbox(): Promise<OutboxItem[]>;
  saveOutboxItem(item: OutboxItem): Promise<void>;
  removeOutboxItem(opId: string): Promise<void>;
  loadMeta(): Promise<{ deviceId: string; seq: number; cursor: number; versions: Record<string, number> } | undefined>;
  saveMeta(meta: { deviceId: string; seq: number; cursor: number; versions: Record<string, number> }): Promise<void>;
  addDiscarded(d: DiscardedOp): Promise<void>;
  listDiscarded(): Promise<DiscardedOp[]>;
  /** Opcional: grava estado, meta e itens da fila numa única transação (tudo ou nada). */
  commit?(batch: { state?: TournamentState; meta?: { deviceId: string; seq: number; cursor: number; versions: Record<string, number> }; outboxPut?: OutboxItem[]; outboxRemove?: string[] }): Promise<void>;
}

export interface Transport {
  push(ops: Operation[]): Promise<PushResult[]>;
  health(): Promise<boolean>;
  pull(tournamentId: string, since: number): Promise<PullResponse>;
  resolveServer(conflictId: string): Promise<void>;
  discardRejected(deviceId: string, entityKey: string): Promise<void>;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): () => void;
}

export type SyncUiState = 'online' | 'offline' | 'syncing' | 'pending' | 'failed' | 'conflict';

export const BACKOFF_SECONDS = [2, 5, 15, 30, 60];
export const BATCH_SIZE = 50;

export interface EngineOptions {
  storage: ClientStorage;
  transport: Transport;
  scheduler?: Scheduler;
  newId: () => string;
  now: () => string;
  rng?: () => number;
}

export interface Snapshot {
  ui: SyncUiState;
  pending: number;
  inFlight: number;
  rejected: number;
  conflicts: number;
  blocked: number;
  network: boolean;
  lastError?: string;
  nextRetryInMs?: number;
}

export class SyncEngine {
  state: TournamentState = emptyState();
  outbox: OutboxItem[] = [];
  meta = { deviceId: '', seq: 0, cursor: 0, versions: {} as Record<string, number> };
  network = true;
  lastError?: string;
  private failures = 0;
  private running = false;
  private rerun = false;
  private cancelRetry?: () => void;
  private nextRetryAt?: number;
  private listeners = new Set<() => void>();
  readonly opt: Required<Omit<EngineOptions, 'rng' | 'scheduler'>> & { rng: () => number; scheduler: Scheduler };

  constructor(opt: EngineOptions) {
    this.opt = {
      ...opt,
      rng: opt.rng ?? Math.random,
      scheduler: opt.scheduler ?? { setTimeout: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); } },
    };
  }

  async init(): Promise<void> {
    const { storage } = this.opt;
    this.state = (await storage.loadState()) ?? emptyState();
    const meta = await storage.loadMeta();
    this.meta = meta ?? { deviceId: this.opt.newId(), seq: 0, cursor: 0, versions: {} };
    if (!meta) await storage.saveMeta(this.meta);
    this.outbox = (await storage.loadOutbox()).sort((a, b) => a.op.seq - b.op.seq);
    // Operações que estavam em voo quando o app fechou voltam a pendentes: o servidor é idempotente.
    for (const it of this.outbox) if (it.status === 'inflight') { it.status = 'pending'; await storage.saveOutboxItem(it); }
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  snapshot(): Snapshot {
    const count = (s: OutboxStatus): number => this.outbox.filter((i) => i.status === s).length;
    const pending = count('pending');
    const inFlight = count('inflight');
    const conflicts = count('conflict');
    const rejected = count('rejected');
    const blocked = count('blocked');
    let ui: SyncUiState = 'online';
    if (!this.network) ui = 'offline';
    else if (conflicts > 0) ui = 'conflict';
    else if (inFlight > 0) ui = 'syncing';
    else if (this.lastError && (pending > 0 || rejected > 0)) ui = 'failed';
    else if (pending > 0 || rejected > 0 || blocked > 0) ui = 'pending';
    return { ui, pending, inFlight, rejected, conflicts, blocked, network: this.network, lastError: this.lastError, nextRetryInMs: this.nextRetryAt ? Math.max(0, this.nextRetryAt - Date.now()) : undefined };
  }

  /** Aplica o comando localmente (otimista) e o enfileira. Lança `DomainError` sem enfileirar se for inválido. */
  /** Serializa dispatch, pull e rebase: nenhum deles enxerga o estado pela metade. */
  private chain: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async persist(b: { state?: TournamentState; meta?: { deviceId: string; seq: number; cursor: number; versions: Record<string, number> }; outboxPut?: OutboxItem[]; outboxRemove?: string[] }): Promise<void> {
    const { storage } = this.opt;
    if (storage.commit) return storage.commit(b);
    if (b.state) await storage.saveState(b.state);
    if (b.meta) await storage.saveMeta(b.meta);
    for (const id of b.outboxRemove ?? []) await storage.removeOutboxItem(id);
    for (const i of b.outboxPut ?? []) await storage.saveOutboxItem(i);
  }

  dispatch(input: Command): Promise<{ warnings: string[]; opId: string }> {
    return this.serial(() => this.dispatchNow(input));
  }

  private async dispatchNow(input: Command): Promise<{ warnings: string[]; opId: string }> {
    // O servidor recebe JSON (chaves `undefined` somem); aplicar o mesmo formato aqui evita divergência.
    const cmd = JSON.parse(JSON.stringify(input)) as Command;
    const opId = this.opt.newId();
    const createdAt = this.opt.now();
    const result = apply(this.state, cmd, { now: createdAt, deviceId: this.meta.deviceId, opId });
    const target = commandTarget(cmd);
    const tournamentId = this.state.tournament?.id ?? (cmd.type === 'tournament.save' ? cmd.payload.tournament.id : '');
    const key = entityKey(tournamentId, target.entityType, target.entityId);
    const op: Operation = {
      opId,
      deviceId: this.meta.deviceId,
      seq: ++this.meta.seq,
      type: cmd.type,
      entityType: target.entityType,
      entityId: target.entityId,
      tournamentId,
      baseVersion: this.meta.versions[key],
      payload: cmd.payload,
      clientCreatedAt: createdAt,
      schemaVersion: SCHEMA_VERSION,
    };
    const before = { state: this.state, seq: this.meta.seq - 1, outbox: [...this.outbox] };
    this.state = result.state;
    const dropped = this.enqueue(op);
    // Estado, meta e operação são gravados juntos antes de qualquer envio: nada se perde se o app fechar agora.
    try {
      await this.persist({ state: this.state, meta: this.meta, outboxPut: [this.outbox.find((i) => i.op.opId === opId) as OutboxItem], outboxRemove: dropped ? [dropped] : [] });
    } catch (e) {
      // Não confirma o que não foi gravado: desfaz a mudança em memória e avisa quem chamou.
      this.state = before.state;
      this.meta.seq = before.seq;
      this.outbox = before.outbox;
      this.emit();
      throw e;
    }
    this.emit();
    this.opt.scheduler.setTimeout(() => void this.sync(), 1000);
    return { warnings: result.warnings, opId };
  }

  /** Compactação: só `match.live_score` pendente da mesma partida é substituído (SPECS §7.6). */
  private enqueue(op: Operation): string | undefined {
    let dropped: string | undefined;
    if (op.type === 'match.live_score') {
      const prev = this.outbox.find((i) => i.status === 'pending' && i.op.type === 'match.live_score' && i.op.entityId === op.entityId);
      if (prev) {
        dropped = prev.op.opId;
        this.outbox = this.outbox.filter((i) => i !== prev);
      }
    }
    this.outbox.push({ op, status: 'pending', attempts: 0 });
    return dropped;
  }

  async setNetwork(ok: boolean): Promise<void> {
    const was = this.network;
    this.network = ok;
    this.emit();
    if (ok && !was) await this.sync();
  }

  /** Verificação de rede real, por /health (SPECS §7.5). */
  async heartbeat(): Promise<boolean> {
    let ok = false;
    try {
      ok = await this.opt.transport.health();
    } catch {
      ok = false;
    }
    await this.setNetwork(ok);
    return ok;
  }

  private scheduleRetry(): void {
    this.cancelRetry?.();
    const base = BACKOFF_SECONDS[Math.min(this.failures - 1, BACKOFF_SECONDS.length - 1)] as number;
    const ms = Math.round(base * 1000 * (0.8 + this.opt.rng() * 0.4));
    this.nextRetryAt = Date.now() + ms;
    this.cancelRetry = this.opt.scheduler.setTimeout(() => void this.sync(), ms);
  }

  /** Envia o outbox em ordem de `seq`. Reentrante: chamadas concorrentes viram uma nova rodada. */
  async sync(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.round();
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }

  private async round(): Promise<void> {
    const { storage, transport } = this.opt;
    // Operação "bloqueada" sem nenhuma pendência de conflito/rejeição na mesma entidade é bloqueio velho
    // (ex.: a causa foi resolvida em outra rodada): volta para a fila em vez de ficar parada para sempre.
    for (const b of this.outbox.filter((i) => i.status === 'blocked')) {
      const cause = this.outbox.some((o) => (o.status === 'conflict' || o.status === 'rejected') && o.op.entityType === b.op.entityType && o.op.entityId === b.op.entityId);
      if (!cause) {
        b.status = 'pending';
        await storage.saveOutboxItem(b);
      }
    }
    for (;;) {
      const batch = this.outbox.filter((i) => i.status === 'pending').slice(0, BATCH_SIZE);
      if (batch.length === 0) {
        this.failures = 0;
        this.lastError = undefined;
        this.cancelRetry?.();
        this.nextRetryAt = undefined;
        this.emit();
        return;
      }
      for (const it of batch) {
        it.status = 'inflight';
        it.attempts++;
        await storage.saveOutboxItem(it);
      }
      this.emit();
      let results: PushResult[];
      try {
        results = await transport.push(batch.map((i) => i.op));
      } catch (e) {
        for (const it of batch) {
          it.status = 'pending';
          await storage.saveOutboxItem(it);
        }
        this.failures++;
        this.lastError = e instanceof Error ? e.message : 'Falha de rede';
        this.network = false;
        this.scheduleRetry();
        this.emit();
        return;
      }
      this.network = true;
      const byId = new Map(results.map((r) => [r.opId, r]));
      let retry = false;
      for (const it of batch) {
        const r = byId.get(it.op.opId);
        if (!r) {
          it.status = 'pending'; // sem resposta: reenvia (idempotente)
          retry = true;
          await storage.saveOutboxItem(it);
          continue;
        }
        await this.handleResult(it, r);
      }
      await storage.saveMeta(this.meta);
      this.emit();
      if (retry) {
        this.failures++;
        this.scheduleRetry();
        return;
      }
    }
  }

  private async handleResult(it: OutboxItem, r: PushResult): Promise<void> {
    const { storage } = this.opt;
    switch (r.status) {
      case 'applied':
      case 'duplicate': {
        if (r.newVersion !== undefined) {
          const key = entityKey(it.op.tournamentId, it.op.entityType, it.op.entityId);
          this.meta.versions[key] = Math.max(this.meta.versions[key] ?? 0, r.newVersion);
        }
        this.outbox = this.outbox.filter((x) => x !== it);
        await storage.removeOutboxItem(it.op.opId);
        return;
      }
      case 'rejected':
        it.status = 'rejected';
        it.error = r.error;
        break;
      case 'conflict':
        it.status = 'conflict';
        it.conflictId = r.conflictId;
        break;
      case 'blocked':
        it.status = 'blocked';
        it.conflictId = r.conflictId;
        it.error = r.error;
        break;
    }
    await storage.saveOutboxItem(it);
  }

  /** Reconstrói o estado local: estado do servidor + operações ainda na fila. */
  rebase(serverState: TournamentState): Promise<void> {
    return this.serial(() => this.rebaseNow(serverState));
  }

  private async rebaseNow(serverState: TournamentState): Promise<void> {
    let st = serverState;
    for (const it of this.outbox.slice().sort((a, b) => a.op.seq - b.op.seq)) {
      try {
        st = apply(st, { type: it.op.type, payload: it.op.payload } as Command, { now: it.op.clientCreatedAt, deviceId: it.op.deviceId, opId: it.op.opId }).state;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
      }
    }
    this.state = st;
    await this.opt.storage.saveState(st);
  }

  async pull(tournamentId?: string): Promise<PullResponse | undefined> {
    const tid = tournamentId ?? this.state.tournament?.id ?? this.outbox[0]?.op.tournamentId;
    if (!tid) return undefined;
    const res = await this.opt.transport.pull(tid, this.meta.cursor);
    if (res.unchanged) return res;
    await this.serial(async () => {
      if (res.versions) Object.assign(this.meta.versions, res.versions);
      this.meta.cursor = res.cursor;
      await this.opt.storage.saveMeta(this.meta);
      if (res.state) await this.rebaseNow(res.state);
    });
    this.emit();
    return res;
  }

  conflictItems(): OutboxItem[] {
    return this.outbox.filter((i) => i.status === 'conflict');
  }

  /**
   * Resolução (SPECS §7.4). `device`: reenvia a operação com `resolution` e a versão atual do servidor.
   * `server`: o valor do servidor vence e a operação vai para `discardedOps`, recuperável.
   */
  async resolveConflict(conflict: ConflictRecord, keep: 'device' | 'server'): Promise<void> {
    const { storage, transport } = this.opt;
    const item = this.outbox.find((i) => i.op.opId === conflict.op.opId);
    if (!item) return;
    if (keep === 'device') {
      item.op = { ...item.op, baseVersion: conflict.serverVersion, resolution: { conflictId: conflict.id, keep: 'device' } };
      item.status = 'pending';
      delete item.error;
      await storage.saveOutboxItem(item);
      for (const b of this.outbox.filter((i) => i.status === 'blocked' && i.op.entityId === item.op.entityId && i.op.entityType === item.op.entityType)) {
        b.status = 'pending';
        await storage.saveOutboxItem(b);
      }
      await this.sync();
      return;
    }
    await transport.resolveServer(conflict.id);
    this.outbox = this.outbox.filter((i) => i !== item);
    await storage.removeOutboxItem(item.op.opId);
    await storage.addDiscarded({ op: item.op, reason: 'server_kept', at: this.opt.now() });
    for (const b of this.outbox.filter((i) => i.status === 'blocked' && i.op.entityId === item.op.entityId)) {
      b.status = 'pending';
      await storage.saveOutboxItem(b);
    }
    this.meta.versions[conflict.entityKey] = conflict.serverVersion;
    this.meta.cursor = 0;
    await storage.saveMeta(this.meta);
    await this.pull();
    await this.sync();
  }

  /** Descarta uma operação rejeitada (fica registrada em `discardedOps`). */
  async discardRejected(opId: string): Promise<void> {
    const item = this.outbox.find((i) => i.op.opId === opId && i.status === 'rejected');
    if (!item) return;
    const { storage, transport } = this.opt;
    this.outbox = this.outbox.filter((i) => i !== item);
    await storage.removeOutboxItem(opId);
    await storage.addDiscarded({ op: item.op, reason: 'user_discarded', at: this.opt.now() });
    await transport.discardRejected(item.op.deviceId, entityKey(item.op.tournamentId, item.op.entityType, item.op.entityId));
    for (const b of this.outbox.filter((i) => i.status === 'blocked')) {
      b.status = 'pending';
      await storage.saveOutboxItem(b);
    }
    await this.rebase((await this.pullState()) ?? emptyState());
    await this.sync();
  }

  private async pullState(): Promise<TournamentState | undefined> {
    const tid = this.state.tournament?.id ?? this.outbox[0]?.op.tournamentId;
    if (!tid) return undefined;
    const res = await this.opt.transport.pull(tid, -1);
    return res.state;
  }
}
