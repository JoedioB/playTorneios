import { detectScheduleIssues } from '@playtorneios/domain';
import type { TournamentState } from '@playtorneios/domain';

export interface Step { key: string; title: string; done: boolean; detail: string; to: string; cta: string; optional?: boolean }

/** Passos de preparação do torneio, deduzidos só do estado local (funciona offline). Ordem = ciclo de vida. */
export function setupSteps(s: TournamentState): Step[] {
  const cats = Object.values(s.categories);
  const regs = Object.values(s.registrations).filter((r) => r.status !== 'canceled');
  const inCat = (id: string, status?: string) => regs.filter((r) => r.categoryId === id && (!status || r.status === status)).length;
  const courts = Object.keys(s.courts).length;
  const pending = regs.filter((r) => r.status === 'pending').length;
  const approvedRegs = regs.filter((r) => r.status === 'approved');
  const eligible = cats.filter((c) => inCat(c.id, 'approved') >= 2);
  const missing = eligible.filter((c) => !s.brackets[c.id]);
  const real = Object.values(s.matches).filter((m) => m.slotA.kind !== 'bye' && m.slotB.kind !== 'bye');
  const unscheduled = real.filter((m) => m.lifecycle !== 'finished' && (!m.scheduledAt || !m.courtId)).length;
  const conflicts = real.length ? detectScheduleIssues(s).length : 0;
  const checked = approvedRegs.filter((r) => r.checkedInA && r.checkedInB).length;
  const t = s.tournament;
  return [
    { key: 'torneio', title: 'Dados do torneio', done: !!t, detail: t ? `${t.name} · ${t.city}. Revise datas, local e identidade visual.` : 'Crie o torneio.', to: '/torneio', cta: 'Revisar dados' },
    { key: 'quadras', title: 'Quadras', done: courts > 0, detail: courts ? `${courts} quadra(s) cadastrada(s).` : 'Cadastre as quadras onde haverá jogos.', to: '/quadras', cta: 'Cadastrar quadras' },
    { key: 'categorias', title: 'Categorias e regras', done: cats.length > 0, detail: cats.length ? `${cats.length} categoria(s) criada(s).` : 'Crie ao menos uma categoria (formato, pontuação e vagas).', to: '/categorias', cta: 'Criar categorias' },
    { key: 'duplas', title: 'Duplas inscritas', done: cats.some((c) => inCat(c.id) >= 2), detail: !cats.length ? 'Crie uma categoria antes de inscrever duplas.' : `${regs.length} inscrição(ões) em ${cats.length} categoria(s). Cada chave precisa de 2 duplas ou mais.`, to: '/duplas', cta: 'Cadastrar duplas' },
    { key: 'aprovacao', title: 'Inscrições aprovadas', done: eligible.length > 0 && pending === 0, detail: pending ? `${pending} inscrição(ões) a aprovar.` : eligible.length ? `${approvedRegs.length} dupla(s) aprovada(s).` : 'Aprove ao menos 2 duplas em uma categoria.', to: '/inscricoes', cta: 'Aprovar inscrições' },
    { key: 'chaves', title: 'Chaves', done: eligible.length > 0 && missing.length === 0, detail: eligible.length ? `${eligible.length - missing.length} de ${eligible.length} categoria(s) com chave gerada.` : 'Disponível depois que uma categoria tiver 2 duplas aprovadas.', to: missing[0] ? `/chaves/${missing[0].id}` : '/chaves', cta: 'Gerar chaves' },
    { key: 'agenda', title: 'Agenda', done: real.length > 0 && unscheduled === 0 && conflicts === 0, detail: !real.length ? 'Disponível depois de gerar as chaves.' : unscheduled ? `${unscheduled} partida(s) sem quadra ou horário.` : conflicts ? `${conflicts} conflito(s) de agenda.` : 'Todas as partidas têm quadra e horário.', to: '/agenda', cta: 'Montar agenda' },
    { key: 'checkin', title: 'Check-in', optional: true, done: approvedRegs.length > 0 && checked === approvedRegs.length, detail: approvedRegs.length ? `${checked} de ${approvedRegs.length} dupla(s) com os dois atletas presentes.` : 'Disponível depois de aprovar duplas.', to: '/inscricoes', cta: 'Fazer check-in' },
  ];
}
