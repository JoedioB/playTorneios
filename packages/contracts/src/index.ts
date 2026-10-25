import { z } from 'zod';
import { COMMAND_TYPES } from '@playtorneios/domain';
import type { CommandType } from '@playtorneios/domain';

const id = z.string().min(1).max(128);
/** Id de torneio: sem '%', '_' ou '/' (usado como prefixo de chaves). */
const tournamentIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const iso = z.string().min(10).max(40);
const text = (max = 200) => z.string().trim().max(max);

const setScore = z.object({ a: z.number().int().min(0).max(99), b: z.number().int().min(0).max(99) });

export const scoringRule = z.discriminatedUnion('model', [
  z.object({ model: z.literal('target'), targetPoints: z.number().int().min(1).max(99), winBy: z.union([z.literal(1), z.literal(2)]), cap: z.number().int().min(1).max(99).optional() }),
  z.object({
    model: z.literal('sets'),
    bestOf: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    setPoints: z.number().int().min(1).max(99),
    decidingSetPoints: z.number().int().min(1).max(99).optional(),
    winBy: z.union([z.literal(1), z.literal(2)]),
    cap: z.number().int().min(1).max(99).optional(),
  }),
]);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const tournamentPatch = z
  .object({
    id,
    organizationId: id,
    name: text(120).min(1),
    organizationName: text(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    city: text(80),
    venue: text(120),
    description: text(2000).optional(),
    status: z.enum(['draft', 'open', 'closed']),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80),
    theme: z.object({ primary: hex, accent: hex, logoAssetId: id.optional(), logoDataUrl: z.string().max(90_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional() }),
    publish: z.object({
      published: z.boolean(),
      autoPublishOnSync: z.boolean(),
      sections: z.object({ pairs: z.boolean(), brackets: z.boolean(), schedule: z.boolean(), results: z.boolean(), podium: z.boolean() }),
      showDisplayNames: z.boolean(),
    }),
    defaults: z.object({ matchDurationMin: z.number().int().min(1).max(240), restMin: z.number().int().min(0).max(240) }),
  })
  .partial()
  .required({ id: true })
  .strict();

const courtPatch = z.object({ id, name: text(60).min(1), location: text(120).optional(), order: z.number().int().min(0) }).partial().required({ id: true }).strict();

const categoryPatch = z
  .object({
    id,
    name: text(80).min(1),
    level: z.enum(['beginner', 'intermediate', 'advanced', 'open']).optional(),
    gender: z.enum(['male', 'female', 'mixed']).optional(),
    ageRange: z.object({ min: z.number().int().min(0).max(120).optional(), max: z.number().int().min(0).max(120).optional(), referenceDate: z.string().optional() }).optional(),
    format: z.enum(['single_elimination', 'groups_then_knockout']),
    formatConfig: z.object({ groups: z.number().int().min(2).max(16).optional(), advancePerGroup: z.number().int().min(1).max(8).optional() }),
    scoring: scoringRule,
    groupScoring: scoringRule.optional(),
    tiebreakers: z.array(z.enum(['wins', 'head_to_head', 'set_diff', 'point_diff', 'points_for', 'manual_draw'])).max(6),
    woCredit: z.union([z.literal('none'), z.object({ winnerPoints: z.number().int().min(0).max(99), loserPoints: z.number().int().min(0).max(99) })]),
    capacity: z.number().int().min(2).max(512).optional(),
    waitlistEnabled: z.boolean(),
    thirdPlaceMatch: z.boolean(),
  })
  .partial()
  .required({ id: true })
  .strict();

const athletePatch = z
  .object({
    id,
    fullName: text(120).min(1),
    phone: text(30).optional(),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    gender: z.enum(['male', 'female']).optional(),
    city: text(80).optional(),
  })
  .partial()
  .required({ id: true })
  .strict();

const pairPatch = z.object({ id, athleteAId: id, athleteBId: id, displayName: text(80).optional() }).partial().required({ id: true }).strict();

const resultPayload = z
  .object({
    resultId: id,
    matchId: id,
    kind: z.enum(['normal', 'walkover', 'retired']),
    sets: z.array(setScore).max(5).optional(),
    points: setScore.optional(),
    winnerPairId: id.optional(),
    retiredPairId: id.optional(),
    reason: text(500).optional(),
    confirmToken: z.string().max(64).optional(),
    expectedA: id.optional(),
    expectedB: id.optional(),
  })
  .strict();

/** Um schema por tipo de comando. O servidor valida o `payload` com ele antes de chamar o domínio (SPECS §8.4). */
export const payloadSchemas: Record<CommandType, z.ZodTypeAny> = {
  'tournament.save': z.object({ tournament: tournamentPatch, reason: text(500).optional() }).strict(),
  'court.save': z.object({ court: courtPatch }).strict(),
  'court.delete': z.object({ courtId: id }).strict(),
  'category.save': z.object({ category: categoryPatch }).strict(),
  'category.delete': z.object({ categoryId: id }).strict(),
  'athlete.save': z.object({ athlete: athletePatch }).strict(),
  'athlete.anonymize': z.object({ athleteId: id }).strict(),
  'pair.save': z.object({ pair: pairPatch, confirmed: z.boolean().optional() }).strict(),
  'registration.create': z.object({ registrationId: id, categoryId: id, pairId: id }).strict(),
  'registration.setStatus': z.object({ registrationId: id, status: z.enum(['pending', 'approved', 'canceled', 'waitlist']) }).strict(),
  'registration.checkIn': z.object({ registrationId: id, side: z.enum(['a', 'b']), value: z.boolean() }).strict(),
  'registration.setSeed': z.object({ registrationId: id, seed: z.number().int().min(1).max(512).nullable() }).strict(),
  'bracket.generate': z.object({ categoryId: id, seed: z.number().int().min(0).max(4294967295), confirmToken: z.string().max(64).optional() }).strict(),
  'match.schedule': z.object({ matchId: id, courtId: id.nullable(), scheduledAt: iso.nullable() }).strict(),
  'schedule.apply': z.object({ assignments: z.array(z.object({ matchId: id, courtId: id, scheduledAt: iso }).strict()).max(1000) }).strict(),
  'match.start': z.object({ matchId: id }).strict(),
  'match.live_score': z.object({ matchId: id, a: z.number().int().min(0).max(99), b: z.number().int().min(0).max(99) }).strict(),
  'bracket.swap': z
    .object({
      categoryId: id,
      a: z.object({ matchId: id, side: z.enum(['a', 'b']) }).strict(),
      b: z.object({ matchId: id, side: z.enum(['a', 'b']) }).strict(),
      confirmToken: z.string().max(64).optional(),
    })
    .strict(),
  'result.record': resultPayload,
  'tie.resolve': z
    .object({ tie: z.object({ id, tournamentId: id, categoryId: id, groupId: id, orderedPairIds: z.array(id).min(2).max(16), reason: text(300).min(1) }).strict() })
    .strict(),
};

export const operationSchema = z
  .object({
    opId: id,
    deviceId: id,
    seq: z.number().int().min(0),
    type: z.enum(COMMAND_TYPES as [CommandType, ...CommandType[]]),
    entityType: z.string().min(1).max(32),
    entityId: z.string().max(128),
    tournamentId: tournamentIdSchema,
    baseVersion: z.number().int().min(0).optional(),
    payload: z.unknown(),
    clientCreatedAt: iso,
    schemaVersion: z.number().int().min(1),
    resolution: z.object({ conflictId: id, keep: z.literal('device') }).optional(),
  })
  .strict()
  .superRefine((op, ctx) => {
    const r = payloadSchemas[op.type].safeParse(op.payload);
    if (!r.success) {
      for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: ['payload', ...i.path], message: i.message });
    }
  });

export const pushRequestSchema = z.object({ operations: z.array(operationSchema).min(1).max(100) }).strict();

export const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).strict();

export const signupSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(10, 'A senha precisa ter pelo menos 10 caracteres.').max(200),
    organizationName: text(120).min(1),
  })
  .strict();

export const resolveConflictSchema = z.object({ keep: z.enum(['device', 'server']) }).strict();

export const discardSchema = z.object({ deviceId: id, entityKey: z.string().min(1).max(300) }).strict();

export type PushRequest = z.infer<typeof pushRequestSchema>;

export function formatZodError(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; ');
}
