import { apply, commandTarget, DomainError, emptyState, fieldsOverlap } from '@playtorneios/domain';
import type { Command, TournamentState } from '@playtorneios/domain';
import { entityKey } from './types.ts';
import type { ChangeEntry, ConflictRecord, Operation, PullResponse, PushResult } from './types.ts';

/** Acesso transacional ao armazenamento do servidor. A implementação real (PostgreSQL) está em apps/api. */
export interface ServerTx {
  getState(tournamentId: string): Promise<TournamentState | undefined>;
  putState(tournamentId: string, state: TournamentState): Promise<void>;
  getApplied(deviceId: string, opId: string): Promise<PushResult | undefined>;
  putApplied(deviceId: string, opId: string, result: PushResult, tournamentId?: string): Promise<void>;
  getVersion(key: string): Promise<number>;
  bumpVersion(key: string, fields: string[], deviceId: string): Promise<number>;
  changesSince(key: string, version: number): Promise<ChangeEntry[]>;
  getHalt(deviceId: string, key: string): Promise<string | undefined>;
  setHalt(deviceId: string, key: string, opId: string): Promise<void>;
  clearHalt(deviceId: string, key: string): Promise<void>;
  getConflict(id: string): Promise<ConflictRecord | undefined>;
  putConflict(c: ConflictRecord): Promise<void>;
  listConflicts(tournamentId: string, status?: 'open'): Promise<ConflictRecord[]>;
  nextCursor(tournamentId: string): Promise<number>;
  getCursor(tournamentId: string): Promise<number>;
  allVersions(tournamentId: string): Promise<Record<string, number>>;
}

export interface ServerStore {
  transaction<T>(fn: (tx: ServerTx) => Promise<T>): Promise<T>;
}

function entityValue(state: TournamentState, op: Operation): unknown {
  const id = op.entityId;
  switch (op.entityType) {
    case 'tournament':
      return state.tournament;
    case 'court':
      return state.courts[id];
    case 'category':
      return state.categories[id];
    case 'athlete':
      return state.athletes[id];
    case 'pair':
      return state.pairs[id];
    case 'registration':
      return state.registrations[id];
    case 'match':
      return state.matches[id];
    case 'result':
      return state.results[id];
    case 'tie':
      return state.ties[id];
    case 'bracket':
      return { meta: state.brackets[id], matches: Object.values(state.matches).filter((m) => m.categoryId === id) };
    default:
      return undefined;
  }
}

/**
 * Aplica UMA operação em uma transação: idempotência, bloqueio causal, detecção de conflito e regras de domínio.
 * O servidor reaplica os mesmos comandos do cliente (SPECS §7, G3), usando `clientCreatedAt` como relógio
 * para que ambos os lados cheguem exatamente ao mesmo estado.
 */
export async function applyOperationServer(store: ServerStore, op: Operation, serverNow: string): Promise<PushResult> {
  return store.transaction(async (tx) => {
    const done = await tx.getApplied(op.deviceId, op.opId);
    if (done && !(op.resolution && done.status === 'conflict')) {
      return done.status === 'applied' ? { ...done, status: 'duplicate' as const } : done;
    }

    const cmd = { type: op.type, payload: op.payload } as Command;
    let target;
    try {
      target = commandTarget(cmd);
    } catch {
      return reject(tx, op, 'PAYLOAD_INVALID', 'Operação malformada.');
    }
    const key = entityKey(op.tournamentId, target.entityType, target.entityId);

    // Conflito aberto na entidade, ou operação anterior do mesmo aparelho parada nela: bloqueia, sem registrar.
    const resolving = op.resolution ? await tx.getConflict(op.resolution.conflictId) : undefined;
    const openConflict = (await tx.listConflicts(op.tournamentId, 'open')).find((c) => c.entityKey === key);
    const halted = await tx.getHalt(op.deviceId, key);
    const isResolution = !!resolving && resolving.status === 'open' && resolving.entityKey === key && resolving.op.deviceId === op.deviceId;
    if (!isResolution && (openConflict || halted)) {
      return { opId: op.opId, status: 'blocked' as const, conflictId: openConflict?.id, error: { code: 'BLOCKED', message: 'Há uma operação anterior nesta entidade aguardando decisão.' } };
    }

    const state = (await tx.getState(op.tournamentId)) ?? emptyState();
    const current = await tx.getVersion(key);

    if (!isResolution && op.baseVersion !== undefined && op.baseVersion < current) {
      const others = (await tx.changesSince(key, op.baseVersion)).filter((c) => c.deviceId !== op.deviceId);
      if (others.some((c) => fieldsOverlap(c.fields, target.fields))) {
        const conflict: ConflictRecord = {
          id: `cf-${op.deviceId}-${op.opId}`,
          tournamentId: op.tournamentId,
          entityKey: key,
          entityType: target.entityType,
          entityId: target.entityId,
          op,
          serverValue: entityValue(state, op),
          serverVersion: current,
          status: 'open',
          createdAt: serverNow,
        };
        await tx.putConflict(conflict);
        await tx.setHalt(op.deviceId, key, op.opId);
        const result: PushResult = { opId: op.opId, status: 'conflict', conflictId: conflict.id, newVersion: current };
        await tx.putApplied(op.deviceId, op.opId, result, op.tournamentId);
        return result;
      }
    }

    let next: TournamentState;
    let warnings: string[];
    try {
      const r = apply(state, cmd, { now: op.clientCreatedAt, deviceId: op.deviceId, opId: op.opId });
      next = r.state;
      warnings = r.warnings;
    } catch (e) {
      if (e instanceof DomainError) return reject(tx, op, e.code, e.message, e.details, key);
      throw e;
    }

    await tx.putState(op.tournamentId, next);
    const newVersion = await tx.bumpVersion(key, target.fields, op.deviceId);
    await tx.nextCursor(op.tournamentId);

    if (isResolution && resolving) {
      await tx.putConflict({ ...resolving, status: 'resolved_device', resolvedAt: serverNow, overwrittenValue: resolving.serverValue });
      await tx.clearHalt(op.deviceId, key);
    }
    const result: PushResult = { opId: op.opId, status: 'applied', newVersion, warnings };
    await tx.putApplied(op.deviceId, op.opId, result, op.tournamentId);
    return result;
  });
}

async function reject(tx: ServerTx, op: Operation, code: string, message: string, details?: unknown, key?: string): Promise<PushResult> {
  const result: PushResult = { opId: op.opId, status: 'rejected', error: { code, message, details } };
  await tx.putApplied(op.deviceId, op.opId, result, op.tournamentId);
  if (key) await tx.setHalt(op.deviceId, key, op.opId);
  return result;
}

export async function pushOperations(store: ServerStore, ops: Operation[], serverNow: string): Promise<PushResult[]> {
  const out: PushResult[] = [];
  for (const op of ops.slice().sort((a, b) => a.seq - b.seq)) out.push(await applyOperationServer(store, op, serverNow));
  return out;
}

export async function pullChanges(store: ServerStore, tournamentId: string, since: number): Promise<PullResponse> {
  return store.transaction(async (tx) => {
    const cursor = await tx.getCursor(tournamentId);
    const openConflicts = await tx.listConflicts(tournamentId, 'open');
    if (since >= cursor && cursor > 0) return { cursor, unchanged: true, openConflicts };
    const state = (await tx.getState(tournamentId)) ?? emptyState();
    return { cursor, state, versions: await tx.allVersions(tournamentId), openConflicts };
  });
}

/** Aparelho escolhe "manter o servidor": a operação sai da fila de bloqueio; o valor do servidor prevalece. */
export async function resolveConflictServer(store: ServerStore, conflictId: string, serverNow: string): Promise<void> {
  await store.transaction(async (tx) => {
    const c = await tx.getConflict(conflictId);
    if (!c || c.status !== 'open') return;
    await tx.putConflict({ ...c, status: 'resolved_server', resolvedAt: serverNow });
    await tx.clearHalt(c.op.deviceId, c.entityKey);
  });
}

/** Aparelho descarta uma operação rejeitada: libera as seguintes na mesma entidade. */
export async function discardRejected(store: ServerStore, deviceId: string, entityKeyValue: string): Promise<void> {
  await store.transaction(async (tx) => {
    await tx.clearHalt(deviceId, entityKeyValue);
  });
}
