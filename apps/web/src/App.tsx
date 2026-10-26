import { useCallback, useEffect, useState } from 'react';
import { api, HttpError } from './data/http-transport.ts';
import { SESSION_KEY, signOut } from './lib/session.ts';
import { useRuntime } from './data/runtime.tsx';
import { useRoute } from './lib/router.ts';
import { AgendaScreen } from './screens/agenda.tsx';
import { CategoriasScreen } from './screens/categorias.tsx';
import { CentralScreen } from './screens/central.tsx';
import { ChavesScreen } from './screens/chaves.tsx';
import { DuplasScreen, InscricoesScreen } from './screens/duplas.tsx';
import { EncerramentoScreen } from './screens/encerramento.tsx';
import { PlacarScreen } from './screens/placar.tsx';
import { JuizesScreen } from './screens/juizes.tsx';
import { ImprimirScreen } from './screens/imprimir.tsx';
import { TelaoScreen } from './screens/telao.tsx';
import { LoginScreen } from './screens/login.tsx';
import { PublicoScreen } from './screens/publico.tsx';
import { QuadrasScreen } from './screens/quadras.tsx';
import { ResultadosScreen } from './screens/resultados.tsx';
import { RelatoriosScreen, SistemaScreen } from './screens/sistema.tsx';
import { SyncScreen } from './screens/sync.tsx';
import { Onboarding, TorneioScreen } from './screens/torneio.tsx';
import { LockGate } from './ui/lockgate.tsx';
import { TabGuard } from './ui/tabguard.tsx';
import { Shell } from './ui/shell.tsx';
import { ToastRegion } from './ui/kit.tsx';
import { WANT_NEW, clearWanted, rememberCurrent, wantedTournament } from './lib/tournaments.ts';


function Screens() {
  const { path } = useRoute();
  switch (path[0] ?? '') {
    case '': return <CentralScreen />;
    case 'agenda': return <AgendaScreen />;
    case 'chaves': return <ChavesScreen />;
    case 'resultados': return <ResultadosScreen />;
    case 'inscricoes': return <InscricoesScreen />;
    case 'duplas': return <DuplasScreen />;
    case 'categorias': return <CategoriasScreen />;
    case 'quadras': return <QuadrasScreen />;
    case 'juizes': return <JuizesScreen />;
    case 'imprimir': return <ImprimirScreen />;
    case 'torneio': return <TorneioScreen />;
    case 'publico': return <PublicoScreen />;
    case 'relatorios': return <RelatoriosScreen />;
    case 'encerramento': return <EncerramentoScreen />;
    case 'sync': return <SyncScreen />;
    case 'sistema': return <SistemaScreen />;
    default: return <main id="conteudo"><h1>Página não encontrada</h1><p><a href="#/">Voltar para a Central</a></p></main>;
  }
}

/**
 * Porta de entrada. Offline-first: se já existe torneio neste aparelho, o app abre mesmo sem rede ou sem
 * sessão válida (a sessão só é exigida para sincronizar). Sem torneio local, é preciso entrar primeiro.
 */
export function App() {
  return <TabGuard><LockGate onSignOut={() => void signOut()}><AppInner /></LockGate></TabGuard>;
}

function AppInner() {
  const route = useRoute();
  const { state, engine, setSession, session, sync } = useRuntime();
  const [auth, setAuth] = useState<'checking' | 'ok' | 'anon' | 'offline'>('checking');

  const check = useCallback(async () => {
    try {
      const me = await api.get<{ user: { email: string; organizationId: string } }>('/api/auth/me');
      setSession(me.user);
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(me.user)); } catch { /* sem armazenamento */ }
      setAuth('ok');
      if (!engine.state.tournament) {
        const want = wantedTournament();
        if (want === WANT_NEW) {
          // Quem pediu "Criar novo torneio" fica na tela de criação, sem baixar nada.
        } else if (want) {
          await engine.pull(want);
        } else {
          const list = await api.get<{ tournaments: Array<{ id: string }> }>('/api/tournaments');
          const first = list.tournaments[0];
          if (first) await engine.pull(first.id);
        }
      } else {
        void engine.sync();
      }
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) { setSession(null); setAuth('anon'); }
      else setAuth('offline');
    }
  }, [engine, setSession]);

  useEffect(() => { void check(); }, [check]);
  // Lembra deste torneio para o seletor e encerra o pedido de abertura (já foi atendido).
  useEffect(() => {
    const t = state.tournament;
    if (!t) return;
    rememberCurrent(t.id, t.name);
    clearWanted();
  }, [state.tournament?.id, state.tournament?.name]);
  useEffect(() => { if (sync.network && auth === 'offline') void check(); }, [sync.network, auth, check]);

  if (auth === 'checking') return <p role="status" style={{ padding: '2rem' }}>Verificando sessão…</p>;
  if (!state.tournament) {
    if (auth === 'anon') return <><LoginScreen onDone={() => void check()} /><ToastRegion /></>;
    return <><Onboarding /><ToastRegion /></>;
  }
  if (route.path[0] === 'telao') return <TelaoScreen />;
  if (route.path[0] === 'placar' && route.path[1]) return <PlacarScreen matchId={route.path[1]} />;
  return (
    <Shell>
      {auth === 'anon' && !session && (
        <p className="banner" role="status" style={{ marginBottom: '1rem' }}>
          Sessão expirada: você pode continuar trabalhando, mas as alterações só serão enviadas depois que você <a href="#/entrar" onClick={(e) => { e.preventDefault(); setAuth('anon'); location.hash = '#/sessao'; }}>entrar de novo</a>.
        </p>
      )}
      {route.path[0] === 'sessao' ? <LoginScreen expired onDone={() => { location.hash = '#/'; void check(); }} /> : <Screens />}
    </Shell>
  );
}
