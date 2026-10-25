import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type LockManager = { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void> | void) => Promise<void> };

/**
 * Uma aba por vez: duas abas com o mesmo banco local gravariam estado e fila uma por cima da outra.
 * O bloqueio é solto sozinho quando a aba fecha. Sem suporte a `navigator.locks`, segue sem guarda.
 */
export function TabGuard({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<'checking' | 'ok' | 'busy'>('checking');
  const held = useRef(false);
  const requested = useRef(false);
  const attempt = useCallback(() => {
    const locks = (navigator as unknown as { locks?: LockManager }).locks;
    if (!locks) return setSt('ok');
    if (held.current) return setSt('ok');
    if (requested.current) return; // pedido em andamento (ex.: efeito duplicado em desenvolvimento)
    requested.current = true;
    void locks.request('playtorneios-engine', { ifAvailable: true }, (lock) => {
      if (!lock) { requested.current = false; setSt('busy'); return; }
      held.current = true;
      setSt('ok');
      return new Promise<void>(() => undefined); // mantém o bloqueio até a aba fechar
    });
  }, []);
  useEffect(() => { attempt(); }, [attempt]);

  if (st === 'checking') return null;
  if (st === 'busy') {
    return (
      <main id="conteudo" tabIndex={-1} style={{ maxWidth: '36rem', margin: '4rem auto', padding: '1rem' }}>
        <h1>O playTorneios já está aberto em outra aba</h1>
        <p>Para não misturar dados, use uma aba por vez neste navegador. Feche a outra aba ou volte para ela.</p>
        <button className="btn" type="button" onClick={attempt}>Tentar de novo</button>
      </main>
    );
  }
  return <>{children}</>;
}
