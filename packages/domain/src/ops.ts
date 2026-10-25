import type { Assignment } from './schedule.ts';
import type {
  Athlete,
  Category,
  Court,
  EntityType,
  Id,
  Pair,
  RegistrationStatus,
  ResultKind,
  SetScore,
  TieResolution,
  Tournament,
} from './types.ts';

type Patch<T extends { id: Id }> = Partial<T> & { id: Id };

/** Comandos de negócio. Cada um vira uma operação do outbox (SPECS §7.1). */
export type Command =
  | { type: 'tournament.save'; payload: { tournament: Patch<Tournament>; reason?: string } }
  | { type: 'court.save'; payload: { court: Patch<Court> } }
  | { type: 'court.delete'; payload: { courtId: Id } }
  | { type: 'category.save'; payload: { category: Patch<Category> } }
  | { type: 'category.delete'; payload: { categoryId: Id } }
  | { type: 'athlete.save'; payload: { athlete: Patch<Athlete> } }
  | { type: 'athlete.anonymize'; payload: { athleteId: Id } }
  | { type: 'pair.save'; payload: { pair: Patch<Pair>; confirmed?: boolean } }
  | { type: 'registration.create'; payload: { registrationId: Id; categoryId: Id; pairId: Id } }
  | { type: 'registration.setStatus'; payload: { registrationId: Id; status: RegistrationStatus } }
  | { type: 'registration.checkIn'; payload: { registrationId: Id; side: 'a' | 'b'; value: boolean } }
  | { type: 'registration.setSeed'; payload: { registrationId: Id; seed: number | null } }
  | { type: 'bracket.generate'; payload: { categoryId: Id; seed: number; confirmToken?: string } }
  | { type: 'bracket.swap'; payload: { categoryId: Id; a: { matchId: Id; side: 'a' | 'b' }; b: { matchId: Id; side: 'a' | 'b' }; confirmToken?: string } }
  | { type: 'match.schedule'; payload: { matchId: Id; courtId: Id | null; scheduledAt: string | null } }
  | { type: 'schedule.apply'; payload: { assignments: Assignment[] } }
  | { type: 'match.start'; payload: { matchId: Id } }
  | { type: 'match.live_score'; payload: { matchId: Id; a: number; b: number } }
  | { type: 'result.record'; payload: ResultPayload }
  | { type: 'tie.resolve'; payload: { tie: Omit<TieResolution, 'resolvedAt'> } };

export interface ResultPayload {
  resultId: Id;
  matchId: Id;
  kind: Exclude<ResultKind, 'pending'>;
  sets?: SetScore[];
  points?: { a: number; b: number };
  winnerPairId?: Id;
  retiredPairId?: Id;
  reason?: string;
  confirmToken?: string;
  /** Duplas que o organizador via ao lançar. Se a chave mudou nesse meio tempo (outro aparelho), o resultado é recusado. */
  expectedA?: Id;
  expectedB?: Id;
}

export type CommandType = Command['type'];

export const COMMAND_TYPES: CommandType[] = [
  'tournament.save',
  'court.save',
  'court.delete',
  'category.save',
  'category.delete',
  'athlete.save',
  'athlete.anonymize',
  'pair.save',
  'registration.create',
  'registration.setStatus',
  'registration.checkIn',
  'registration.setSeed',
  'bracket.generate',
  'bracket.swap',
  'match.schedule',
  'schedule.apply',
  'match.start',
  'match.live_score',
  'result.record',
  'tie.resolve',
];

export interface Target {
  entityType: EntityType;
  entityId: Id;
  /** Campos alterados; `*` = entidade inteira. Usado para detectar sobreposição (SPECS §7.4). */
  fields: string[];
}

const META = new Set(['id', 'tournamentId', 'updatedAt']);
const keysOf = (o: object): string[] => Object.keys(o).filter((k) => !META.has(k));

/** Entidade principal afetada por um comando, para versão e conflito. */
export function commandTarget(cmd: Command): Target {
  switch (cmd.type) {
    case 'tournament.save':
      return { entityType: 'tournament', entityId: cmd.payload.tournament.id, fields: keysOf(cmd.payload.tournament) };
    case 'court.save':
      return { entityType: 'court', entityId: cmd.payload.court.id, fields: keysOf(cmd.payload.court) };
    case 'court.delete':
      return { entityType: 'court', entityId: cmd.payload.courtId, fields: ['*'] };
    case 'category.save':
      return { entityType: 'category', entityId: cmd.payload.category.id, fields: keysOf(cmd.payload.category) };
    case 'category.delete':
      return { entityType: 'category', entityId: cmd.payload.categoryId, fields: ['*'] };
    case 'athlete.save':
      return { entityType: 'athlete', entityId: cmd.payload.athlete.id, fields: keysOf(cmd.payload.athlete) };
    case 'athlete.anonymize':
      return { entityType: 'athlete', entityId: cmd.payload.athleteId, fields: ['*'] };
    case 'pair.save':
      return { entityType: 'pair', entityId: cmd.payload.pair.id, fields: keysOf(cmd.payload.pair) };
    case 'registration.create':
      return { entityType: 'registration', entityId: cmd.payload.registrationId, fields: ['*'] };
    case 'registration.setStatus':
      return { entityType: 'registration', entityId: cmd.payload.registrationId, fields: ['status'] };
    case 'registration.checkIn':
      return { entityType: 'registration', entityId: cmd.payload.registrationId, fields: [cmd.payload.side === 'a' ? 'checkedInA' : 'checkedInB'] };
    case 'registration.setSeed':
      return { entityType: 'registration', entityId: cmd.payload.registrationId, fields: ['seed'] };
    case 'bracket.generate':
      return { entityType: 'bracket', entityId: cmd.payload.categoryId, fields: ['*'] };
    case 'bracket.swap':
      return { entityType: 'bracket', entityId: cmd.payload.categoryId, fields: ['*'] };
    case 'match.schedule':
      return { entityType: 'match', entityId: cmd.payload.matchId, fields: ['courtId', 'scheduledAt'] };
    case 'schedule.apply':
      return { entityType: 'match', entityId: cmd.payload.assignments[0]?.matchId ?? '', fields: ['courtId', 'scheduledAt'] };
    case 'match.start':
      return { entityType: 'match', entityId: cmd.payload.matchId, fields: ['lifecycle'] };
    case 'match.live_score':
      return { entityType: 'match', entityId: cmd.payload.matchId, fields: ['live'] };
    case 'result.record':
      return { entityType: 'result', entityId: cmd.payload.matchId, fields: ['result'] };
    case 'tie.resolve':
      return { entityType: 'tie', entityId: cmd.payload.tie.id, fields: ['*'] };
  }
}

export function fieldsOverlap(a: string[], b: string[]): boolean {
  if (a.includes('*') || b.includes('*')) return true;
  return a.some((f) => b.includes(f));
}
