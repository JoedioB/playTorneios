// Tipos de domínio do playTorneios. Sem dependências: o pacote inteiro é TypeScript puro
// (SPECS §3.1). Datas são strings ISO em UTC; a conversão para America/Sao_Paulo é da interface.

export type Id = string;
export type IsoDateTime = string;
export type IsoDate = string; // 'YYYY-MM-DD'

export type TournamentStatus = 'draft' | 'open' | 'closed';
export type Gender = 'male' | 'female' | 'mixed';
export type Level = 'beginner' | 'intermediate' | 'advanced' | 'open';
export type RegistrationStatus = 'pending' | 'approved' | 'canceled' | 'waitlist';
export type CompetitionFormat = 'single_elimination' | 'groups_then_knockout';

export type TiebreakerKey =
  | 'wins'
  | 'head_to_head'
  | 'set_diff'
  | 'point_diff'
  | 'points_for'
  | 'manual_draw';

export type ScoringRule =
  | { model: 'target'; targetPoints: number; winBy: 1 | 2; cap?: number }
  | {
      model: 'sets';
      bestOf: 1 | 3 | 5;
      setPoints: number;
      decidingSetPoints?: number;
      winBy: 1 | 2;
      cap?: number;
    };

export interface PublishSettings {
  published: boolean;
  autoPublishOnSync: boolean;
  sections: {
    pairs: boolean;
    brackets: boolean;
    schedule: boolean;
    results: boolean;
    podium: boolean;
  };
  showDisplayNames: boolean;
}

export interface Theme {
  primary: string;
  accent: string;
  logoAssetId?: Id;
}

export interface Tournament {
  id: Id;
  organizationId: Id;
  name: string;
  organizationName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  city: string;
  venue: string;
  description?: string;
  status: TournamentStatus;
  slug: string;
  theme: Theme;
  publish: PublishSettings;
  defaults: { matchDurationMin: number; restMin: number };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Court {
  id: Id;
  tournamentId: Id;
  name: string;
  location?: string;
  order: number;
  updatedAt: IsoDateTime;
}

export interface FormatConfig {
  groups?: number;
  advancePerGroup?: number;
}

export interface Category {
  id: Id;
  tournamentId: Id;
  name: string;
  level?: Level;
  gender?: Gender;
  ageRange?: { min?: number; max?: number; referenceDate?: IsoDate };
  format: CompetitionFormat;
  formatConfig: FormatConfig;
  /** Regra da fase eliminatória (ou da categoria inteira, em eliminação simples). */
  scoring: ScoringRule;
  /** Regra da fase de grupos; se ausente usa `scoring`. */
  groupScoring?: ScoringRule;
  tiebreakers: TiebreakerKey[];
  /** W.O.: pontos creditados ao vencedor/perdedor nos totais da fase de grupos. */
  woCredit: 'none' | { winnerPoints: number; loserPoints: number };
  capacity?: number;
  waitlistEnabled: boolean;
  thirdPlaceMatch: boolean;
  /** Regras congeladas: preenchido quando a chave é gerada (RF-11). */
  lockedAt?: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Athlete {
  id: Id;
  tournamentId: Id;
  fullName: string;
  phone?: string;
  birthDate?: IsoDate;
  gender?: 'male' | 'female';
  city?: string;
  /** Chave de busca normalizada (minúsculas, sem acentos). */
  searchKey: string;
  anonymizedAt?: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Pair {
  id: Id;
  tournamentId: Id;
  athleteAId: Id;
  athleteBId: Id;
  displayName?: string;
  searchKey: string;
  updatedAt: IsoDateTime;
}

export interface Registration {
  id: Id;
  tournamentId: Id;
  categoryId: Id;
  pairId: Id;
  status: RegistrationStatus;
  waitlistPosition?: number;
  checkedInA: boolean;
  checkedInB: boolean;
  seed?: number;
  updatedAt: IsoDateTime;
}

export type Slot =
  | { kind: 'pair'; pairId: Id }
  | { kind: 'winnerOf'; matchId: Id }
  | { kind: 'loserOf'; matchId: Id }
  | { kind: 'groupPosition'; groupId: Id; position: number }
  | { kind: 'bye' };

export type MatchLifecycle = 'not_started' | 'in_progress' | 'finished';

export interface LiveScore {
  a: number;
  b: number;
  updatedAt: IsoDateTime;
}

export interface Match {
  id: Id;
  tournamentId: Id;
  categoryId: Id;
  phase: 'group' | 'knockout';
  groupId?: Id;
  round: number;
  indexInRound: number;
  label: string;
  slotA: Slot;
  slotB: Slot;
  courtId?: Id;
  scheduledAt?: IsoDateTime;
  durationMin?: number;
  lifecycle: MatchLifecycle;
  live?: LiveScore;
  updatedAt: IsoDateTime;
}

export type ResultKind = 'normal' | 'walkover' | 'retired' | 'pending';

export interface SetScore {
  a: number;
  b: number;
}

export interface ResultRevision {
  id: Id;
  tournamentId: Id;
  matchId: Id;
  revision: number;
  kind: ResultKind;
  /** Participantes (A, B) no momento do registro. Base da invalidação (SPECS §6.7). */
  participants: [Id, Id];
  winnerPairId?: Id;
  sets?: SetScore[];
  points?: { a: number; b: number };
  retiredPairId?: Id;
  reason?: string;
  invalidatedAt?: IsoDateTime;
  invalidatedBy?: 'bracket_change' | 'correction';
  recordedAt: IsoDateTime;
  deviceId: string;
}

export interface TieResolution {
  id: Id;
  tournamentId: Id;
  categoryId: Id;
  groupId: Id;
  /** Duplas empatadas (conjunto) e a ordem decidida. */
  orderedPairIds: Id[];
  reason: string;
  resolvedAt: IsoDateTime;
}

export interface GroupDef {
  id: Id;
  name: string;
  pairIds: Id[];
}

export interface BracketMeta {
  id: Id; // = categoryId
  tournamentId: Id;
  categoryId: Id;
  format: CompetitionFormat;
  seed: number;
  algorithm: 'v1';
  size: number;
  byes: number;
  groups?: GroupDef[];
  advancePerGroup?: number;
  generatedAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AuditEntry {
  id: Id;
  tournamentId: Id;
  entityType: EntityType;
  entityId: Id;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  deviceId: string;
  at: IsoDateTime;
}

export type EntityType =
  | 'tournament'
  | 'court'
  | 'category'
  | 'athlete'
  | 'pair'
  | 'registration'
  | 'match'
  | 'result'
  | 'tie'
  | 'bracket';

/** Agregado de um torneio. É o que o cliente guarda e o que o servidor reconstrói. */
export interface TournamentState {
  tournament: Tournament | null;
  courts: Record<Id, Court>;
  categories: Record<Id, Category>;
  athletes: Record<Id, Athlete>;
  pairs: Record<Id, Pair>;
  registrations: Record<Id, Registration>;
  matches: Record<Id, Match>;
  /** Revisões de resultado por partida, em ordem crescente de `revision`. */
  results: Record<Id, ResultRevision[]>;
  ties: Record<Id, TieResolution>;
  brackets: Record<Id, BracketMeta>;
  audit: AuditEntry[];
}

export function emptyState(): TournamentState {
  return {
    tournament: null,
    courts: {},
    categories: {},
    athletes: {},
    pairs: {},
    registrations: {},
    matches: {},
    results: {},
    ties: {},
    brackets: {},
    audit: [],
  };
}

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}
