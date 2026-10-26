// Vários torneios no mesmo aparelho: um banco IndexedDB por torneio. O app abre um banco por vez
// (o "ativo"); trocar de torneio é trocar o banco ativo e recarregar. Sem estado compartilhado entre torneios.
import { uuid } from './format.ts';

export const DEFAULT_DB = 'playtorneios';
const ACTIVE = 'pt:active';
const WANT = 'pt:want';
const KNOWN = 'pt:known';
/** Valor de `pt:want` que significa "abrir vazio, para criar um torneio novo" (não puxar nada do servidor). */
export const WANT_NEW = '__new__';

export interface KnownTournament {
  id: string;
  name: string;
  db: string;
}

const read = (k: string): string | null => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k: string, v: string | null): void => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem armazenamento */ }
};

export function activeDb(): string {
  const v = read(ACTIVE);
  return v && /^playtorneios[A-Za-z0-9-]*$/.test(v) ? v : DEFAULT_DB;
}

export function listKnown(): KnownTournament[] {
  try {
    const raw = JSON.parse(read(KNOWN) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is KnownTournament => !!x && typeof x.id === 'string' && typeof x.db === 'string' && typeof x.name === 'string') : [];
  } catch { return []; }
}

/** Registra (ou atualiza o nome de) o torneio que está aberto neste banco. */
export function rememberCurrent(id: string, name: string): void {
  const db = activeDb();
  const rest = listKnown().filter((k) => k.id !== id && k.db !== db);
  write(KNOWN, JSON.stringify([...rest, { id, name, db }]));
}

export function forget(id: string): void {
  write(KNOWN, JSON.stringify(listKnown().filter((k) => k.id !== id)));
}

export function wantedTournament(): string | null {
  return read(WANT);
}
export function clearWanted(): void {
  write(WANT, null);
}

function reload(): void {
  location.hash = '#/';
  location.reload();
}

/** Abre outro torneio: o que já existe neste aparelho abre direto; o do servidor é baixado no primeiro acesso. */
export function openTournament(id: string): void {
  const known = listKnown().find((k) => k.id === id);
  if (known) {
    write(ACTIVE, known.db);
    write(WANT, null);
  } else {
    write(ACTIVE, `playtorneios-${id.replace(/[^A-Za-z0-9-]/g, '')}`);
    write(WANT, id);
  }
  reload();
}

/** Abre um banco vazio para criar um torneio novo. */
export function startNewTournament(): void {
  write(ACTIVE, `playtorneios-novo-${uuid().slice(0, 8)}`);
  write(WANT, WANT_NEW);
  reload();
}
