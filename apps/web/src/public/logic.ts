// Regras puras da página pública (sem React, sem DOM): busca, "meu jogo", agrupamento e textos.
// Ficam separadas para serem testadas em node:test, sem navegador.
import type { PublicCategory, PublicMatch, PublicSnapshot } from '@playtorneios/domain';

export type MatchRef = { m: PublicMatch; cat: PublicCategory };

/** Minúsculas, sem acento, espaços colapsados: "  João  Épico " → "joao epico". */
export const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const MIN_QUERY = 2;

/** Todas as palavras digitadas precisam aparecer no nome (em qualquer ordem). */
export function matchesQuery(name: string, query: string): boolean {
  const tokens = norm(query).split(' ').filter(Boolean);
  if (!tokens.length || norm(query).length < MIN_QUERY) return false;
  const n = norm(name);
  return tokens.every((t) => n.includes(t));
}

/** Nomes de duplas que aparecem no snapshot (jogos, classificação e lista), sem repetir. */
export function pairNames(snap: PublicSnapshot): string[] {
  const set = new Set<string>();
  for (const c of snap.categories) {
    for (const p of c.pairs ?? []) set.add(p);
    for (const g of c.groups ?? []) for (const r of g.rows) set.add(r.pair);
    for (const m of c.matches ?? []) { if (m.a) set.add(m.a); if (m.b) set.add(m.b); }
  }
  return [...set].sort((x, y) => x.localeCompare(y, 'pt-BR'));
}

export const allMatches = (snap: PublicSnapshot): MatchRef[] => snap.categories.flatMap((cat) => (cat.matches ?? []).map((m) => ({ m, cat })));
export const involves = (m: PublicMatch, name: string): boolean => m.a === name || m.b === name;
export const liveMatches = (snap: PublicSnapshot): MatchRef[] => allMatches(snap).filter((r) => r.m.status === 'in_progress');

const t = (m: PublicMatch): number => (m.scheduledAt ? Date.parse(m.scheduledAt) : Number.POSITIVE_INFINITY);

/** Próximos jogos: as duas duplas já definidas; por horário (sem horário vai para o fim, na ordem original). */
export function upcoming(snap: PublicSnapshot): MatchRef[] {
  return allMatches(snap)
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.m.status === 'not_started' && r.m.a && r.m.b)
    .sort((x, y) => t(x.r.m) - t(y.r.m) || x.i - y.i)
    .map(({ r }) => r);
}

/** Jogos de uma dupla: ao vivo, depois os próximos (por horário), depois os encerrados (mais recente primeiro). */
export function matchesOfPair(snap: PublicSnapshot, name: string): MatchRef[] {
  const mine = allMatches(snap).filter((r) => involves(r.m, name));
  const rank = (s: PublicMatch['status']) => (s === 'in_progress' ? 0 : s === 'not_started' ? 1 : 2);
  return mine
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const a = rank(x.r.m.status), b = rank(y.r.m.status);
      if (a !== b) return a - b;
      if (a === 2) return t(y.r.m) - t(x.r.m) || y.i - x.i; // Infinity - Infinity = NaN → cai no índice
      return t(x.r.m) - t(y.r.m) || x.i - y.i;
    })
    .map(({ r }) => r);
}

export const phaseOf = (m: PublicMatch): string => m.label.split(' · ')[0] ?? m.label;

/** Mata-mata agrupado por fase, na ordem em que as fases aparecem no snapshot (Quartas → Semifinal → Final). */
export function knockoutRounds(matches: PublicMatch[]): Array<{ phase: string; matches: PublicMatch[] }> {
  const out: Array<{ phase: string; matches: PublicMatch[] }> = [];
  for (const m of matches) {
    if (m.phase !== 'knockout') continue;
    const p = phaseOf(m);
    const last = out.find((x) => x.phase === p);
    if (last) last.matches.push(m); else out.push({ phase: p, matches: [m] });
  }
  return out;
}

export function groupRounds(matches: PublicMatch[]): Array<{ group: string; matches: PublicMatch[] }> {
  const out: Array<{ group: string; matches: PublicMatch[] }> = [];
  for (const m of matches) {
    if (m.phase !== 'group') continue;
    const g = phaseOf(m);
    const cur = out.find((x) => x.group === g);
    if (cur) cur.matches.push(m); else out.push({ group: g, matches: [m] });
  }
  return out;
}

export type CategoryStatus = 'empty' | 'waiting' | 'live' | 'running' | 'done';
export function categoryStatus(c: PublicCategory): CategoryStatus {
  const ms = c.matches ?? [];
  if (c.podium) return 'done';
  if (!ms.length && !(c.groups?.length)) return 'empty';
  if (ms.some((m) => m.status === 'in_progress')) return 'live';
  if (ms.length && ms.every((m) => m.status === 'not_started')) return 'waiting';
  if (ms.length && ms.every((m) => m.status === 'finished')) return 'done';
  return 'running';
}
export const STATUS_TEXT: Record<CategoryStatus, string> = {
  empty: 'Chave ainda não publicada',
  waiting: 'Aguardando início',
  live: 'Tem jogo ao vivo',
  running: 'Em andamento',
  done: 'Encerrada',
};

export const hasContent = (snap: PublicSnapshot): boolean => snap.categories.some((c) => (c.matches?.length ?? 0) > 0 || (c.groups?.length ?? 0) > 0 || !!c.podium || (c.pairs?.length ?? 0) > 0);

// ---------------------------------------------------------------- textos

const TZ = 'America/Sao_Paulo';
const fHM = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
const fYmd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fLong = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const fDayNum = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric' });

export const hm = (iso: string | number): string => fHM.format(new Date(iso));
const ymd = (ms: number): string => fYmd.format(new Date(ms));
/** "15:31" se for hoje (em Brasília); senão "sáb., 28/10 15:31". */
export function whenShort(iso: string, nowMs: number): string {
  return ymd(Date.parse(iso)) === ymd(nowMs) ? hm(iso) : `${fDay.format(new Date(iso)).replace('.,', ',').replace('.', '')} ${hm(iso)}`;
}

export function dateRange(start: string, end: string): string {
  const a = new Date(`${start}T12:00:00Z`), b = new Date(`${end}T12:00:00Z`);
  if (start === end) return fLong.format(a);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${fDayNum.format(a)} a ${fLong.format(b)}`;
  return `${fLong.format(a)} a ${fLong.format(b)}`;
}

/** "agora", "há 40 s", "há 3 min", "há 2 h". Nunca negativo (relógio do aparelho pode estar adiantado). */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return `há ${Math.floor(s / 3600)} h`;
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function scoreText(m: PublicMatch): string {
  if (m.walkover) return 'W.O.';
  if (m.score?.sets?.length) return m.score.sets.map((s) => `${s.a} a ${s.b}`).join(', ');
  if (m.score?.points) return `${m.score.points.a} a ${m.score.points.b}`;
  return '';
}

/** Colunas de placar do cartão: sets fechados (+ set atual, se ao vivo) ou o placar único. */
export function scoreColumns(m: PublicMatch): Array<{ a: number; b: number; current?: boolean }> {
  if (m.status === 'in_progress') {
    // `live.sets` só existe depois da mudança opcional no snapshot (patch separado); sem ela, mostra só o set atual.
    const live = m.live as { a: number; b: number; sets?: Array<{ a: number; b: number }> } | undefined;
    return live ? [...(live.sets ?? []), { a: live.a, b: live.b, current: true }] : [];
  }
  if (m.walkover) return [];
  if (m.score?.sets?.length) return m.score.sets;
  if (m.score?.points) return [m.score.points];
  return [];
}

/** Mensagens para o leitor de tela: só mudanças de estado de jogos das duplas seguidas (sem ruído a cada ponto). */
export function announceDiff(prev: PublicSnapshot | null, next: PublicSnapshot, followed: string[]): string[] {
  if (!prev || !followed.length) return [];
  const before = new Map(allMatches(prev).map((r) => [r.m.id, r.m]));
  const out: string[] = [];
  for (const { m } of allMatches(next)) {
    const p = before.get(m.id);
    if (!p || p.status === m.status) continue;
    const mine = followed.find((f) => involves(m, f));
    if (!mine) continue;
    const other = m.a === mine ? m.b : m.a;
    if (m.status === 'in_progress') out.push(`Começou o jogo de ${mine} contra ${other ?? 'adversário a definir'}.`);
    else if (m.status === 'finished') {
      const won = (m.winner === 'a' ? m.a : m.b) === mine;
      out.push(m.walkover ? `W.O. no jogo de ${mine}.` : `${mine} ${won ? 'venceu' : 'perdeu para'} ${other ?? 'o adversário'}${scoreText(m) ? `, ${scoreText(m)}` : ''}.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- "seguir" (preferência local; nada vai ao servidor)

export const FOLLOW_KEY = 'pt:fav';
export const MAX_FOLLOWED = 6;

/** Lê `{ [slug]: string[] }` com tolerância a lixo (JSON inválido, tipos errados, tamanhos absurdos). */
export function parseFollowed(raw: string | null, slug: string): string[] {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    const list = v && typeof v === 'object' ? (v as Record<string, unknown>)[slug] : undefined;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 160).slice(0, MAX_FOLLOWED) : [];
  } catch { return []; }
}
export function serializeFollowed(raw: string | null, slug: string, names: string[]): string {
  let all: Record<string, unknown> = {};
  try { const v = JSON.parse(raw ?? '{}') as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) all = v as Record<string, unknown>; } catch { /* recomeça */ }
  const next = { ...all };
  if (names.length) next[slug] = names.slice(0, MAX_FOLLOWED); else delete next[slug];
  return JSON.stringify(next);
}

// ---------------------------------------------------------------- cor do texto sobre o destaque

const lin = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export function onAccent(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#0a0e14';
  const l = 0.2126 * lin(parseInt(hex.slice(1, 3), 16)) + 0.7152 * lin(parseInt(hex.slice(3, 5), 16)) + 0.0722 * lin(parseInt(hex.slice(5, 7), 16));
  return l > 0.179 ? '#0a0e14' : '#ffffff';
}
