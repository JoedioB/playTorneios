import type { CommandType, EntityType, Id, TournamentState } from '@playtorneios/domain';

export const SCHEMA_VERSION = 1;

export interface Operation {
  opId: string;
  deviceId: string;
  seq: number;
  type: CommandType;
  entityType: EntityType;
  entityId: Id;
  tournamentId: Id;
  baseVersion?: number;
  payload: unknown;
  clientCreatedAt: string;
  schemaVersion: number;
  resolution?: { conflictId: string; keep: 'device' };
}

export type OpStatus = 'applied' | 'duplicate' | 'rejected' | 'conflict' | 'blocked';

export interface PushResult {
  opId: string;
  status: OpStatus;
  newVersion?: number;
  error?: { code: string; message: string; details?: unknown };
  conflictId?: string;
  warnings?: string[];
}

export interface ConflictRecord {
  id: string;
  tournamentId: Id;
  entityKey: string;
  entityType: EntityType;
  entityId: Id;
  op: Operation;
  /** Valor do servidor no momento do conflito (a entidade inteira), para a tela lado a lado. */
  serverValue: unknown;
  serverVersion: number;
  status: 'open' | 'resolved_device' | 'resolved_server';
  createdAt: string;
  resolvedAt?: string;
  /** Valor antigo do servidor, guardado quando "manter este aparelho" vence (nunca se perde dado). */
  overwrittenValue?: unknown;
}

export interface ChangeEntry {
  version: number;
  fields: string[];
  deviceId: string;
}

export interface PullResponse {
  cursor: number;
  unchanged?: boolean;
  state?: TournamentState;
  versions?: Record<string, number>;
  openConflicts?: ConflictRecord[];
}

export const entityKey = (tournamentId: Id, entityType: EntityType, entityId: Id): string => `${tournamentId}/${entityType}:${entityId}`;
