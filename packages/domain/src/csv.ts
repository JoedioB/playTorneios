import type { TournamentState } from './types.ts';

const BOM = '﻿';

/** Neutraliza fórmulas de planilha (CSV injection) em campos digitados por pessoas. */
export function safeCell(value: unknown): string {
  let t = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return t;
}

function quote(t: string): string {
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV para Excel pt-BR: separador `;`, BOM UTF-8, quebra de linha CRLF (SPECS §12.1). */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map((c) => quote(safeCell(c))).join(';'));
  return BOM + lines.join('\r\n') + '\r\n';
}

const STATUS_PT: Record<string, string> = { pending: 'Pendente', approved: 'Aprovada', canceled: 'Cancelada', waitlist: 'Lista de espera' };

export function registrationsCsv(state: TournamentState): string {
  const rows = Object.values(state.registrations)
    .sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.id.localeCompare(b.id))
    .map((r) => {
      const p = state.pairs[r.pairId];
      const a = p && state.athletes[p.athleteAId];
      const b = p && state.athletes[p.athleteBId];
      return [state.categories[r.categoryId]?.name, a?.fullName, b?.fullName, STATUS_PT[r.status], r.seed ?? '', r.checkedInA ? 'Sim' : 'Não', r.checkedInB ? 'Sim' : 'Não'];
    });
  return toCsv(['Categoria', 'Atleta A', 'Atleta B', 'Situação', 'Semente', 'Presença A', 'Presença B'], rows);
}
