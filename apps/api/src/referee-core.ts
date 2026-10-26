import { buildRefereeView, commandTarget, emptyState } from '@playtorneios/domain';
import type { Command, RefereeView, TournamentState } from '@playtorneios/domain';
import { operationSchema, formatZodError } from '@playtorneios/contracts';
import { SCHEMA_VERSION, discardRejected, entityKey, pushOperations } from '@playtorneios/sync';
import type { Operation, PushResult, ServerStore } from '@playtorneios/sync';

/** Credencial de juiz já validada (token conferido, não revogado, não vencido). */
export interface RefereeLink {
  id: string;
  organizationId: string;
  tournamentId: string;
  courtId: string;
  label: string;
  expiresAt: string;
}

export interface RefereeCommand {
  opId: string;
  type: 'match.start' | 'match.live_score' | 'result.record';
  payload?: unknown;
}

export const refereeDeviceId = (linkId: string): string => `ref-${linkId}`;

const reject = (opId: string, code: string, message: string): PushResult => ({ opId, status: 'rejected', error: { code, message } });

/** Fim do último dia do torneio (America/Sao_Paulo), limitado a `maxDays` a partir de agora; se já passou, 24 h. */
export function defaultExpiry(endDate: string | undefined, nowIso: string, maxDays = 7): string {
  const now = new Date(nowIso).getTime();
  const cap = now + maxDays * 86_400_000;
  const end = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? new Date(`${endDate}T23:59:59-03:00`).getTime() : NaN;
  const chosen = Number.isFinite(end) && end > now ? Math.min(end, cap) : now + 86_400_000;
  return new Date(chosen).toISOString();
}

async function readState(store: ServerStore, tournamentId: string): Promise<TournamentState | undefined> {
  return store.transaction((tx) => tx.getState(tournamentId));
}

/** Visão mínima da quadra do juiz (sem telefone, nascimento, inscrição ou auditoria). */
export async function refereeCourtView(store: ServerStore, link: RefereeLink): Promise<RefereeView | null> {
  const state = await readState(store, link.tournamentId);
  return state ? buildRefereeView(state, link.courtId) : null;
}

/**
 * Política do juiz: só comandos de placar, só da quadra do link, só de partidas sem resultado vigente.
 * Devolve o motivo da recusa, ou null se pode seguir.
 */
function policy(state: TournamentState, link: RefereeLink, c: RefereeCommand): PushResult | null {
  const p = c.payload as { matchId?: unknown };
  const matchId = typeof p?.matchId === 'string' ? p.matchId : '';
  const m = state.matches[matchId];
  if (!m || m.courtId !== link.courtId) return reject(c.opId, 'FORBIDDEN_MATCH', 'Esta partida não é da sua quadra.');
  if (c.type === 'result.record') {
    const r = c.payload as { kind?: string; reason?: unknown; confirmToken?: unknown; expectedA?: unknown; expectedB?: unknown };
    if (r.kind !== 'normal') return reject(c.opId, 'FORBIDDEN_KIND', 'W.O. e abandono são registrados pelo organizador.');
    if (r.reason !== undefined || r.confirmToken !== undefined) return reject(c.opId, 'FORBIDDEN_CORRECTION', 'Correções são feitas pelo organizador.');
    if (typeof r.expectedA !== 'string' || typeof r.expectedB !== 'string') return reject(c.opId, 'VALIDATION', 'Informe as duplas da partida.');
    const revs = state.results[matchId] ?? [];
    const last = revs[revs.length - 1];
    if (last && !last.invalidatedAt && last.kind !== 'pending') {
      return reject(c.opId, 'ALREADY_RECORDED', 'O organizador já registrou o resultado desta partida.');
    }
  }
  return null;
}

/**
 * Aplica os comandos do juiz pelo mesmo caminho das demais escritas (DEC-18): o servidor monta a operação
 * (aparelho do link, relógio do servidor, sem baseVersion) e reaplica as regras do domínio.
 */
export async function refereePush(store: ServerStore, link: RefereeLink, commands: RefereeCommand[], serverNow: string): Promise<PushResult[]> {
  const state = (await readState(store, link.tournamentId)) ?? emptyState();
  const deviceId = refereeDeviceId(link.id);
  const results = new Array<PushResult>(commands.length);
  const ops: Operation[] = [];
  const at: number[] = [];
  // Reenvio de um comando que o servidor já processou (a resposta se perdeu): devolve o resultado guardado, sem reavaliar a política.
  const seen = new Set<string>();
  for (const c of commands) if (await store.transaction((tx) => tx.getApplied(deviceId, c.opId))) seen.add(c.opId);
  commands.forEach((c, i) => {
    const denied = seen.has(c.opId) ? null : policy(state, link, c);
    if (denied) return void (results[i] = denied);
    let target;
    try {
      target = commandTarget({ type: c.type, payload: c.payload } as Command);
    } catch {
      return void (results[i] = reject(c.opId, 'PAYLOAD_INVALID', 'Operação malformada.'));
    }
    const op: Operation = {
      opId: c.opId,
      deviceId,
      seq: i,
      type: c.type,
      entityType: target.entityType,
      entityId: target.entityId,
      tournamentId: link.tournamentId,
      payload: c.payload,
      clientCreatedAt: serverNow,
      schemaVersion: SCHEMA_VERSION,
    };
    const parsed = operationSchema.safeParse(op);
    if (!parsed.success) return void (results[i] = reject(c.opId, 'VALIDATION', formatZodError(parsed.error)));
    ops.push(op);
    at.push(i);
  });
  if (ops.length > 0) {
    const applied = await pushOperations(store, ops, serverNow);
    for (const [k, op] of ops.entries()) {
      const r = applied.find((x) => x.opId === op.opId) as PushResult;
      results[at[k] as number] = r;
      // O juiz não tem fila de reenvio: uma recusa não pode travar os próximos pontos da mesma partida.
      if (r.status === 'rejected') await discardRejected(store, deviceId, entityKey(op.tournamentId, op.entityType, op.entityId));
    }
  }
  return results;
}
