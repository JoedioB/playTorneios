import type { ScoringRule, SetScore, ValidationIssue } from './types.ts';

export interface ScoreEntry {
  points?: { a: number; b: number };
  sets?: SetScore[];
}

/** Padrões do sistema (identificados como tais na interface; não são regulamento oficial). */
export const DEFAULT_GROUP_SCORING: ScoringRule = { model: 'target', targetPoints: 18, winBy: 2, cap: 21 };
export const DEFAULT_KNOCKOUT_SCORING: ScoringRule = {
  model: 'sets',
  bestOf: 3,
  setPoints: 18,
  decidingSetPoints: 15,
  winBy: 2,
};

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Valida um único set ou partida de ponto único. Devolve a mensagem do problema ou null. */
export function setProblem(a: number, b: number, target: number, winBy: 1 | 2, cap?: number): string | null {
  if (!isInt(a) || !isInt(b)) return 'Os pontos precisam ser números inteiros.';
  if (a < 0 || b < 0) return 'Os pontos não podem ser negativos.';
  if (a === b) return 'O placar não pode terminar empatado.';
  const w = Math.max(a, b);
  const l = Math.min(a, b);
  if (cap !== undefined && w === cap) {
    if (l < target - 1) return `Com ${cap} pontos o adversário precisa ter ao menos ${target - 1}.`;
    return null;
  }
  if (w < target) return `O vencedor precisa chegar a ${target} pontos.`;
  if (winBy === 1) {
    if (w !== target) return `A partida termina quando um lado chega a ${target} pontos.`;
    return null;
  }
  if (w === target) {
    if (l > target - 2) return `Terminando com ${target}, o adversário precisa ter no máximo ${target - 2} pontos.`;
    return null;
  }
  if (cap !== undefined && w > cap) return `O teto da regra é ${cap} pontos.`;
  if (l !== w - 2) return 'Depois de passar do alvo, a diferença final precisa ser de 2 pontos.';
  return null;
}

export function validateScore(rule: ScoringRule, entry: ScoreEntry): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (rule.model === 'target') {
    if (!entry.points) {
      issues.push({ code: 'SCORE_MISSING', message: 'Informe o placar final da partida.', path: 'points' });
      return issues;
    }
    const p = setProblem(entry.points.a, entry.points.b, rule.targetPoints, rule.winBy, rule.cap);
    if (p) issues.push({ code: 'SCORE_INVALID', message: p, path: 'points' });
    return issues;
  }
  const sets = entry.sets;
  if (!sets || sets.length === 0) {
    issues.push({ code: 'SCORE_MISSING', message: 'Informe o placar de cada set.', path: 'sets' });
    return issues;
  }
  const need = Math.ceil(rule.bestOf / 2);
  let winsA = 0;
  let winsB = 0;
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i] as SetScore;
    if (winsA >= need || winsB >= need) {
      issues.push({
        code: 'SCORE_EXTRA_SET',
        message: `O set ${i + 1} foi informado depois de a partida estar decidida.`,
        path: `sets[${i}]`,
      });
      break;
    }
    const isDeciding = rule.bestOf > 1 && i === rule.bestOf - 1;
    const target = isDeciding ? (rule.decidingSetPoints ?? rule.setPoints) : rule.setPoints;
    const p = setProblem(s.a, s.b, target, rule.winBy, rule.cap);
    if (p) {
      issues.push({ code: 'SCORE_INVALID', message: `Set ${i + 1}: ${p}`, path: `sets[${i}]` });
      continue;
    }
    if (s.a > s.b) winsA++;
    else winsB++;
  }
  if (issues.length === 0 && winsA < need && winsB < need) {
    issues.push({
      code: 'SCORE_INCOMPLETE',
      message: `Faltam sets: a partida é melhor de ${rule.bestOf} e ninguém chegou a ${need} sets.`,
      path: 'sets',
    });
  }
  return issues;
}

export type WinnerSide = 'a' | 'b';

export function decideWinner(rule: ScoringRule, entry: ScoreEntry): { winner: WinnerSide } | { error: string } {
  const issues = validateScore(rule, entry);
  if (issues.length > 0) return { error: (issues[0] as ValidationIssue).message };
  if (rule.model === 'target') {
    const p = entry.points as { a: number; b: number };
    return { winner: p.a > p.b ? 'a' : 'b' };
  }
  let winsA = 0;
  let winsB = 0;
  for (const s of entry.sets as SetScore[]) {
    if (s.a > s.b) winsA++;
    else winsB++;
  }
  return { winner: winsA > winsB ? 'a' : 'b' };
}

/** Totais de sets e pontos de um placar já validado, do ponto de vista de A e de B. */
export function scoreTotals(rule: ScoringRule, entry: ScoreEntry): {
  setsA: number;
  setsB: number;
  pointsA: number;
  pointsB: number;
} {
  if (rule.model === 'target' || !entry.sets) {
    const p = entry.points ?? { a: 0, b: 0 };
    return { setsA: p.a > p.b ? 1 : 0, setsB: p.b > p.a ? 1 : 0, pointsA: p.a, pointsB: p.b };
  }
  let setsA = 0;
  let setsB = 0;
  let pointsA = 0;
  let pointsB = 0;
  for (const s of entry.sets) {
    if (s.a > s.b) setsA++;
    else if (s.b > s.a) setsB++;
    pointsA += s.a;
    pointsB += s.b;
  }
  return { setsA, setsB, pointsA, pointsB };
}

export function describeRule(rule: ScoringRule): string {
  if (rule.model === 'target') {
    return `Ponto único até ${rule.targetPoints}${rule.winBy === 2 ? `, diferença de 2${rule.cap ? `, teto ${rule.cap}` : ''}` : ''}`;
  }
  const deciding = rule.decidingSetPoints && rule.decidingSetPoints !== rule.setPoints ? `, decisivo de ${rule.decidingSetPoints}` : '';
  return `Melhor de ${rule.bestOf} sets de ${rule.setPoints}${deciding}${rule.winBy === 2 ? ', diferença de 2' : ''}`;
}
