import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRuntime } from '../data/runtime.tsx';

const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  bracket: 'M3 5h6v4H3zM3 15h6v4H3zM15 10h6v4h-6zM9 7h3v10H9M12 12h3',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 20v-2a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  court: 'M3 6h18v12H3zM12 6v12M3 12h18',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-4l-.5 2.5-1.5 1L7 7 5 11l2 1v2l-2 1 2 4 2-.5 1.5 1L11 20h4l.5-2.5 1.5-1 2 .5 2-4-2-1z',
  sync: 'M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4',
  signal: 'M5 19h.01M10 19v-4M15 19V9M20 19V4',
  'signal-off': 'M5 19h.01M10 19v-4M15 19V9M3 3l18 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  warn: 'M12 3L2 20h20zM12 10v4M12 17h.01',
  check: 'M5 12l5 5L20 7',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  x: 'M6 6l12 12M18 6L6 18',
  play: 'M7 4l13 8-13 8z',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  exit: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  queue: 'M4 6h16M4 12h10M4 18h6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
};

export function Icon(props: { name: string; className?: string }) {
  return (
    <svg className={`icon ${props.className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[props.name] ?? PATHS.check} />
    </svg>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'plain';
  size?: 'sm';
  icon?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  label?: string;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type={props.type ?? 'button'}
      className={`btn ${props.variant && props.variant !== 'plain' ? props.variant : ''} ${props.size ?? ''} ${props.className ?? ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      aria-pressed={props.pressed}
    >
      {props.icon && <Icon name={props.icon} />}
      {props.children}
    </button>
  );
}

type Tone = 'ok' | 'warn' | 'err' | 'info' | 'live' | 'mut';
/** Estado sempre com ícone + texto + forma de borda; a cor só reforça (SPECS §11.3). */
export function StatusBadge(props: { icon: string; tone: Tone; shape?: 'solid' | 'dashed' | 'dotted' | 'double' | 'fill'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge t-${props.tone} ${props.shape && props.shape !== 'solid' ? props.shape : ''}`} title={props.title}>
      <Icon name={props.icon} />
      <span>{props.children}</span>
    </span>
  );
}

export function Field(props: { label: string; hint?: string; error?: string; children: (a: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId();
  const desc = [props.hint ? `${id}-h` : '', props.error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="lbl" htmlFor={id}>{props.label}</label>
      {props.children({ id, 'aria-describedby': desc, 'aria-invalid': props.error ? true : undefined })}
      {props.hint && <div className="hint" id={`${id}-h`}>{props.hint}</div>}
      {props.error && <div className="error" id={`${id}-e`}>{props.error}</div>}
    </div>
  );
}

/** Diálogo modal nativo: foco preso, Esc fecha, foco volta ao botão de origem (SPECS §11.3). */
export function Dialog(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; initialFocus?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      const target = props.initialFocus ? d.querySelector<HTMLElement>(props.initialFocus) : null;
      (target ?? d.querySelector<HTMLElement>('input, select, textarea, [data-autofocus]') ?? d.querySelector<HTMLElement>('button'))?.focus();
    } else if (!props.open && d.open) {
      d.close();
      (opener.current as HTMLElement | null)?.focus?.();
    }
  }, [props.open, props.initialFocus]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); props.onClose(); }} onClose={() => { if (props.open) props.onClose(); }}>
      {props.open && (
        <>
          <div className="dlg-head">
            <h2 id={titleId} style={{ margin: 0 }}>{props.title}</h2>
            <Button size="sm" icon="x" label="Fechar" onClick={props.onClose}>Fechar</Button>
          </div>
          <div className="dlg-body">{props.children}</div>
          {props.footer && <div className="dlg-foot">{props.footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Avisos com desfazer: ficam ≥10 s e pausam com foco ou mouse (WCAG 2.2.1). */
export function ToastRegion() {
  const { toasts, dismissToast } = useRuntime();
  return (
    <div className="toasts" role="region" aria-label="Avisos">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onDone={() => dismissToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem(props: { t: ReturnType<typeof useRuntime>['toasts'][number]; onDone: () => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const h = setTimeout(props.onDone, props.t.undo || props.t.kind === 'err' ? 12000 : 6000);
    return () => clearTimeout(h);
  }, [paused, props.onDone, props.t.undo]);
  return (
    <div
      className={`toast ${props.t.kind}`}
      role={props.t.kind === 'err' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span>{props.t.text}</span>
      <span className="row">
        {props.t.undo && <Button size="sm" icon="undo" onClick={() => { void props.t.undo?.(); props.onDone(); }}>Desfazer</Button>}
        <Button size="sm" label="Dispensar aviso" onClick={props.onDone}>OK</Button>
      </span>
    </div>
  );
}

export function PageHead(props: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub && <p className="muted">{props.sub}</p>}
      </div>
      {props.actions && <div className="row">{props.actions}</div>}
    </div>
  );
}

export function Empty(props: { title: string; children?: ReactNode }) {
  return (
    <div className="card" role="note">
      <h3>{props.title}</h3>
      {props.children && <div className="muted">{props.children}</div>}
    </div>
  );
}
