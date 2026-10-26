import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/700.css';
import '@fontsource/saira-condensed/800.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/jetbrains-mono/600.css';
import { registerSW } from 'virtual:pwa-register';
import './ui/styles.css';
import { App } from './App.tsx';
import { DexieStorage } from './data/dexie-storage.ts';
import { HttpTransport } from './data/http-transport.ts';
import { RuntimeProvider } from './data/runtime.tsx';
import { activeDb } from './lib/tournaments.ts';

const storage = new DexieStorage(activeDb());
const transport = new HttpTransport();

let initial: { email: string; organizationId: string } | null = null;
try { initial = JSON.parse(localStorage.getItem('pt:session') ?? 'null'); } catch { initial = null; }

// Pede armazenamento persistente para o navegador não limpar os dados do torneio (SPECS §9.4).
void navigator.storage?.persist?.();

// Atualização segura: o app só oferece recarregar; nunca recarrega sozinho com operações pendentes (SPECS §9.2).
const updateSW = registerSW({
  onNeedRefresh() {
    const el = document.getElementById('sync-live');
    if (el) el.textContent = 'Nova versão disponível. Abra Backup e preparação para atualizar quando a fila estiver vazia.';
    (window as unknown as { __ptUpdate?: () => Promise<void> }).__ptUpdate = () => updateSW(true);
  },
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <RuntimeProvider storage={storage} transport={transport} initialSession={initial}>
      <App />
    </RuntimeProvider>
  </StrictMode>,
);
