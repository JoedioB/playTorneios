import { api } from '../data/http-transport.ts';

export const SESSION_KEY = 'pt:session';

/** Encerra a sessão no servidor (se houver rede) e neste aparelho, e recarrega. Os dados locais do torneio ficam. */
export async function signOut(): Promise<void> {
  try { await api.post('/api/auth/logout'); } catch { /* sem rede: a sessão expira sozinha */ }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* sem armazenamento */ }
  location.reload();
}
