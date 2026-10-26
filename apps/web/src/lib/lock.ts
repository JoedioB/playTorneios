/**
 * Bloqueio local por PIN (SPECS §8.5). Protege o aparelho compartilhado: o PIN nunca é guardado em claro
 * (PBKDF2 com sal aleatório). Não substitui o login do servidor nem criptografa o IndexedDB.
 */
const KEY = 'pt:lock';

export interface LockConfig {
  salt: string;
  hash: string;
  minutes: number;
}

const b64 = (b: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : b)));

async function derive(pin: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 150_000 }, key, 256);
  return b64(bits);
}

export function loadLock(): LockConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockConfig) : null;
  } catch {
    return null;
  }
}

export const validPin = (pin: string): boolean => /^\d{4,8}$/.test(pin);

export async function setPin(pin: string, minutes: number): Promise<void> {
  if (!validPin(pin)) throw new Error('O PIN precisa ter de 4 a 8 números.');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const cfg: LockConfig = { salt, hash: await derive(pin, salt), minutes };
  localStorage.setItem('pt:lock', JSON.stringify(cfg));
}

export function setLockMinutes(minutes: number): void {
  const cfg = loadLock();
  if (cfg) localStorage.setItem('pt:lock', JSON.stringify({ ...cfg, minutes }));
}

export function clearPin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* sem armazenamento */
  }
}

export async function verifyPin(pin: string): Promise<boolean> {
  const cfg = loadLock();
  if (!cfg) return true;
  return (await derive(pin, cfg.salt)) === cfg.hash;
}
