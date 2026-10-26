import type { SyncEngine, DiscardedOp, OutboxItem } from '@playtorneios/sync';
import type { TournamentState } from '@playtorneios/domain';

export interface BackupFile {
  kind: 'playtorneios-backup';
  version: 1;
  exportedAt: string;
  state: TournamentState;
  meta: { deviceId: string; seq: number; cursor: number; versions: Record<string, number> };
  outbox: OutboxItem[];
  discarded: DiscardedOp[];
}

export async function buildBackup(engine: SyncEngine): Promise<BackupFile> {
  return {
    kind: 'playtorneios-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    state: engine.state,
    meta: engine.meta,
    outbox: engine.outbox,
    discarded: await engine.opt.storage.listDiscarded(),
  };
}

/** Valida o formato antes de qualquer gravação: um arquivo ruim nunca sobrescreve dados bons. */
export function parseBackup(text: string): { ok: true; backup: BackupFile } | { ok: false; error: string } {
  let data: any;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'O arquivo não é um backup válido (não é JSON).' }; }
  if (data?.kind !== 'playtorneios-backup') return { ok: false, error: 'Este arquivo não é um backup do playTorneios.' };
  if (data.version !== 1) return { ok: false, error: `Versão de backup não suportada (${data.version}).` };
  if (!data.state || typeof data.state !== 'object' || !data.state.matches || !data.state.categories) return { ok: false, error: 'O backup está incompleto: faltam os dados do torneio.' };
  if (!data.meta?.deviceId) return { ok: false, error: 'O backup está incompleto: faltam os metadados.' };
  return { ok: true, backup: { ...data, outbox: Array.isArray(data.outbox) ? data.outbox : [], discarded: Array.isArray(data.discarded) ? data.discarded : [] } };
}

export function download(name: string, mime: string, data: string | Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
