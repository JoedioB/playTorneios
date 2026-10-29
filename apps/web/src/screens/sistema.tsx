import { useRef, useState } from 'react';
import { athletesPairsCsv, bracketCsv, podiumCsv, registrationsReportCsv, resultsCsv, scheduleCsv } from '@playtorneios/domain';
import { api } from '../data/http-transport.ts';
import type { DexieStorage } from '../data/dexie-storage.ts';
import { useRuntime } from '../data/runtime.tsx';
import { buildBackup, download, parseBackup } from '../lib/backup.ts';
import type { BackupFile } from '../lib/backup.ts';
import { buildReportPdf } from '../lib/pdf.ts';
import { forget } from '../lib/tournaments.ts';
import { signOut } from '../lib/session.ts';
import { clearPin, loadLock, setLockMinutes, setPin, validPin } from '../lib/lock.ts';
import { Button, Dialog, PageHead } from '../ui/kit.tsx';

export function RelatoriosScreen() {
  const { state, toast } = useRuntime();
  const slug = state.tournament?.slug ?? 'torneio';
  const [cat, setCat] = useState('');
  const reports: Array<[string, string, (st: typeof state, at: string, c?: string) => string]> = [
    ['Inscritos', 'inscritos', registrationsReportCsv],
    ['Atletas e duplas', 'atletas-duplas', (st, at) => athletesPairsCsv(st, at)],
    ['Chaves e confrontos', 'chaves', bracketCsv],
    ['Programação', 'programacao', scheduleCsv],
    ['Resultados e classificação', 'resultados', resultsCsv],
    ['Pódio', 'podio', podiumCsv],
  ];
  return (
    <>
      <PageHead title="Relatórios" sub="Tudo é gerado neste aparelho, mesmo sem internet." />
      <div className="grid">
        <section className="card stack"><h2>Planilhas (CSV)</h2>
          <p className="muted">Abrem direto no Excel em português (separador “;”). Cada arquivo traz torneio, categoria e data/hora da geração.</p>
          <label>Categoria
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Todas</option>
              {Object.values(state.categories).sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {reports.map(([label, file, fn]) => (
              <Button key={file} icon="download" onClick={() => download(`${slug}-${file}.csv`, 'text/csv;charset=utf-8', fn(state, new Date().toISOString(), cat || undefined))}>{label}</Button>
            ))}
          </div>
          <p className="muted small">“Atletas e duplas” contém telefone: não publique nem envie a terceiros sem necessidade.</p></section>
        <section className="card stack"><h2>Agenda, resultados e pódio (PDF)</h2><p className="muted">Documento para imprimir ou enviar.</p>
          <Button icon="download" onClick={async () => { try { download(`${slug}-relatorio.pdf`, 'application/pdf', await buildReportPdf(state)); } catch { toast({ text: 'Não foi possível gerar o PDF.', kind: 'err' }); } }}>Baixar PDF</Button></section>
      </div>
    </>
  );
}

export function SistemaScreen() {
  const { engine, storage, state, toast, online } = useRuntime();
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const usage = useStorageUsage();
  const [lock, setLock] = useState(loadLock());
  const [pinInput, setPinInput] = useState('');
  const [delErr, setDelErr] = useState('');
  const savePin = async () => {
    if (!validPin(pinInput)) return toast({ text: 'O PIN precisa ter de 4 a 8 números.', kind: 'err' });
    await setPin(pinInput, lock?.minutes ?? 15);
    setLock(loadLock()); setPinInput('');
    toast({ text: 'PIN definido. O app pedirá o PIN ao abrir e depois de ficar parado.', kind: 'ok' });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseBackup(await f.text());
    if (!r.ok) return toast({ text: r.error, kind: 'err' });
    setPending(r.backup);
  };
  const restore = async () => {
    if (!pending) return;
    await (storage as DexieStorage).replaceAll({ state: pending.state, meta: pending.meta, outbox: pending.outbox, discarded: pending.discarded });
    location.reload();
  };
  const wipeLocal = async () => {
    if (state.tournament) forget(state.tournament.id);
    await (storage as DexieStorage).replaceAll({ outbox: [], discarded: [] });
    location.href = '/';
  };
  const del = async () => {
    const t = state.tournament;
    if (!t) return;
    try {
      await api.del(`/api/tournaments/${encodeURIComponent(t.id)}`);
    } catch (e) {
      // 404 = o servidor nunca recebeu o torneio; qualquer outra falha mantém tudo e avisa.
      if ((e as { status?: number }).status !== 404) {
        setDelErr('Não foi possível excluir no servidor agora. Nada foi apagado. Tente de novo com conexão, ou exclua só deste aparelho (o servidor continuará com os dados).');
        return;
      }
    }
    await wipeLocal();
  };
  return (
    <>
      <PageHead title="Backup e segurança" />
      <div className="grid">
        <section className="card stack"><h2>Backup</h2><p className="muted">Guarde uma cópia completa (inclui a fila de envio). Faça antes do evento e depois de cada dia.</p>
          <Button variant="primary" icon="download" onClick={async () => { download(`playtorneios-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(await buildBackup(engine), null, 2)); toast({ text: 'Backup baixado.', kind: 'ok' }); }}>Baixar backup</Button></section>
        <section className="card stack"><h2>Restaurar</h2><p className="muted">Substitui os dados deste aparelho pelos do arquivo. Mostramos um resumo antes de confirmar.</p>
          <input ref={file} type="file" accept="application/json,.json" className="sr-only" id="restore-file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <label htmlFor="restore-file" className="btn" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.current?.click(); } }}>Escolher arquivo de backup</label></section>
        <section className="card stack"><h2>Armazenamento</h2><p>{usage}</p><p className="muted small">Se o navegador limpar os dados, restaure um backup. Instale o app (“Adicionar à tela inicial”) para reduzir esse risco.</p></section>
        <section className="card stack"><h2>Preparação para o evento</h2>
          <ul className="small"><li>{online ? '✔' : '✖'} Servidor acessível agora</li><li>{'serviceWorker' in navigator ? '✔' : '✖'} Funciona sem internet (service worker)</li><li>{state.tournament ? '✔' : '✖'} Torneio criado</li><li>{Object.keys(state.courts).length ? '✔' : '✖'} Quadras cadastradas</li><li>{Object.keys(state.matches).length ? '✔' : '✖'} Chave gerada</li></ul></section>
        <section className="card stack"><h2>Bloqueio e sessão</h2>
          <p className="muted">{lock ? `PIN ativo: o app bloqueia ao abrir e após ${lock.minutes} min parado.` : 'Defina um PIN para proteger os dados de atletas neste aparelho compartilhado.'}</p>
          <label>{lock ? 'Novo PIN (4 a 8 números)' : 'PIN (4 a 8 números)'}
            <input type="password" inputMode="numeric" autoComplete="off" value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
          {lock && <label>Bloquear após
            <select value={lock.minutes} onChange={(e) => { setLockMinutes(Number(e.target.value)); setLock(loadLock()); }}>
              {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
            </select></label>}
          <div className="row">
            <Button onClick={() => void savePin()} disabled={pinInput.length < 4}>{lock ? 'Trocar PIN' : 'Definir PIN'}</Button>
            {lock && <button className="btn" type="button" onClick={() => { clearPin(); setLock(null); }}>Remover PIN</button>}
          </div>
          <button className="btn" type="button" onClick={() => void signOut()}>Sair da conta neste aparelho</button>
        </section>
        <section className="card stack"><h2>Excluir torneio (LGPD)</h2><p className="muted">Apaga o torneio daqui e do servidor, com atletas, resultados e página pública. Não dá para desfazer.</p>
          <Button variant="danger" icon="x" onClick={() => setDelOpen(true)}>Excluir torneio…</Button></section>
      </div>
      <Dialog open={!!pending} title="Restaurar backup" onClose={() => setPending(null)} initialFocus="[data-safe]"
        footer={<><button className="btn" data-safe type="button" onClick={() => setPending(null)}>Cancelar</button><Button variant="danger" onClick={() => void restore()}>Substituir dados deste aparelho</Button></>}>
        {pending && <p>Backup de <strong>{new Date(pending.exportedAt).toLocaleString('pt-BR')}</strong>: torneio “{pending.state.tournament?.name ?? '—'}”, {Object.keys(pending.state.matches).length} partida(s), {pending.outbox.length} operação(ões) na fila. Os dados atuais deste aparelho serão substituídos.</p>}
      </Dialog>
      <Dialog open={delOpen} title="Excluir torneio" onClose={() => setDelOpen(false)} initialFocus="[data-safe]"
        footer={<><button className="btn" data-safe type="button" onClick={() => setDelOpen(false)}>Manter torneio</button><Button variant="danger" disabled={confirm !== state.tournament?.name} onClick={() => void del()}>Excluir definitivamente</Button></>}>
        <p>Para confirmar, digite o nome do torneio: <strong>{state.tournament?.name}</strong></p>
        <input aria-label="Nome do torneio para confirmar" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        {delErr && <><p role="alert" className="field-error">{delErr}</p><button className="btn" type="button" onClick={() => void wipeLocal()}>Excluir só deste aparelho</button></>}
      </Dialog>
    </>
  );
}

function useStorageUsage(): string {
  const [txt, setTxt] = useState('Calculando…');
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    void (async () => {
      try {
        const e = await navigator.storage?.estimate?.();
        const persisted = await navigator.storage?.persisted?.();
        if (e?.usage !== undefined && e.quota) setTxt(`Usando ${(e.usage / 1048576).toFixed(1)} MB de ${(e.quota / 1048576).toFixed(0)} MB. Armazenamento ${persisted ? 'protegido' : 'não protegido'} contra limpeza automática.`);
        else setTxt('O navegador não informa o uso de armazenamento.');
      } catch { setTxt('O navegador não informa o uso de armazenamento.'); }
    })();
  }
  return txt;
}
