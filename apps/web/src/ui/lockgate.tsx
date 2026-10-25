import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { loadLock, verifyPin } from '../lib/lock.ts';
import { Button, Dialog } from './kit.tsx';

/** Bloqueia o app ao abrir e depois de alguns minutos sem uso, quando há PIN configurado. */
export function LockGate({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const [locked, setLocked] = useState<boolean>(() => !!loadLock());
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [tries, setTries] = useState(0);
  const last = useRef(Date.now());

  useEffect(() => {
    const touch = () => { last.current = Date.now(); };
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      const cfg = loadLock();
      if (cfg && Date.now() - last.current > cfg.minutes * 60_000) setLocked(true);
    }, 15_000);
    return () => { evs.forEach((e) => window.removeEventListener(e, touch)); window.clearInterval(timer); };
  }, []);

  const unlock = async () => {
    if (await verifyPin(pin)) {
      setLocked(false); setPin(''); setErr(''); setTries(0); last.current = Date.now();
    } else {
      setTries((n) => n + 1);
      setErr('PIN incorreto.');
      setPin('');
      // Atraso crescente contra tentativa em sequência.
      await new Promise((r) => setTimeout(r, Math.min(5000, 500 * (tries + 1))));
    }
  };

  return (
    <>
      <div aria-hidden={locked} {...(locked ? { inert: true } : {})}>{children}</div>
      <Dialog open={locked} title="App bloqueado" onClose={() => undefined} initialFocus="input"
        footer={<><button className="btn" type="button" onClick={onSignOut}>Sair</button><Button disabled={pin.length < 4} onClick={() => void unlock()}>Desbloquear</Button></>}>
        <p>Digite o PIN para continuar. Seus dados continuam salvos neste aparelho.</p>
        <label>PIN
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} aria-invalid={!!err} aria-describedby={err ? 'pin-err' : undefined}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4) void unlock(); }} />
        </label>
        {err && <p id="pin-err" role="alert" className="field-error">{err}</p>}
      </Dialog>
    </>
  );
}
