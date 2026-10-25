import type { Athlete, Category, IsoDate } from './types.ts';

export interface EligibilityWarning {
  code: 'AGE_BELOW' | 'AGE_ABOVE' | 'AGE_UNKNOWN' | 'GENDER_MISMATCH' | 'GENDER_UNKNOWN' | 'MIXED_NEEDS_BOTH';
  athleteId: string;
  message: string;
}

export function ageOn(birthDate: IsoDate, reference: IsoDate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ry, rm, rd] = reference.split('-').map(Number) as [number, number, number];
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age--;
  return age;
}

/** Elegibilidade é aviso ao administrador, nunca bloqueio silencioso (SPECS §6.9). */
export function checkEligibility(athletes: Athlete[], category: Category, fallbackReference: IsoDate): EligibilityWarning[] {
  const out: EligibilityWarning[] = [];
  const range = category.ageRange;
  const ref = range?.referenceDate ?? fallbackReference;
  for (const a of athletes) {
    if (range && (range.min !== undefined || range.max !== undefined)) {
      if (!a.birthDate) {
        out.push({ code: 'AGE_UNKNOWN', athleteId: a.id, message: `${a.fullName}: sem data de nascimento; a faixa etária não pôde ser conferida.` });
      } else {
        const age = ageOn(a.birthDate, ref);
        if (range.min !== undefined && age < range.min) {
          out.push({ code: 'AGE_BELOW', athleteId: a.id, message: `${a.fullName} tem ${age} anos; a categoria exige no mínimo ${range.min}.` });
        }
        if (range.max !== undefined && age > range.max) {
          out.push({ code: 'AGE_ABOVE', athleteId: a.id, message: `${a.fullName} tem ${age} anos; a categoria aceita no máximo ${range.max}.` });
        }
      }
    }
    if (category.gender === 'male' || category.gender === 'female') {
      if (!a.gender) {
        out.push({ code: 'GENDER_UNKNOWN', athleteId: a.id, message: `${a.fullName}: gênero não informado; não foi possível conferir a categoria.` });
      } else if (a.gender !== category.gender) {
        out.push({ code: 'GENDER_MISMATCH', athleteId: a.id, message: `${a.fullName} não corresponde ao gênero da categoria.` });
      }
    }
  }
  if (category.gender === 'mixed' && athletes.length === 2 && athletes.every((a) => a.gender) && athletes[0]!.gender === athletes[1]!.gender) {
    out.push({ code: 'MIXED_NEEDS_BOTH', athleteId: athletes[0]!.id, message: 'Categoria mista: a dupla precisa ter um atleta de cada gênero.' });
  }
  return out;
}
