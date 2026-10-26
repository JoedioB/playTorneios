/** Fila curta de comandos do juiz, guardada no aparelho para reenviar após uma queda breve de sinal. */
export interface QueuedCommand { opId: string; type: 'match.start' | 'match.live_score' | 'result.record'; payload: Record<string, unknown> }

const KEY = 'pt_ref_queue';
const MAX = 60;

export function loadQueue(): QueuedCommand[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as QueuedCommand[]).slice(-MAX) : [];
  } catch { return []; }
}

export function saveQueue(q: QueuedCommand[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX))); } catch { /* sem armazenamento */ }
}

/** Só o último placar ao vivo de cada partida importa: os anteriores são descartados ao enfileirar. */
export function enqueue(q: QueuedCommand[], c: QueuedCommand): QueuedCommand[] {
  const next = c.type === 'match.live_score'
    ? q.filter((x) => !(x.type === 'match.live_score' && x.payload.matchId === c.payload.matchId))
    : q.slice();
  next.push(c);
  return next.slice(-MAX);
}
