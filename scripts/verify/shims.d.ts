// SOMENTE para verificação em ambiente sem registry npm (tsconfig.verify.json).
// O projeto real usa os tipos instalados por `pnpm install`; este arquivo não entra no build nem no Docker.
declare module 'pg' {
  export interface QueryResult { rows: any[]; rowCount: number | null }
  export interface PoolClient { query(sql: string, params?: unknown[]): Promise<QueryResult>; release(): void }
  export class Pool {
    constructor(o?: any);
    query(sql: string, params?: unknown[]): Promise<QueryResult>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    on(ev: string, fn: (e: Error) => void): this;
  }
  const pg: { Pool: typeof Pool };
  export default pg;
}
declare module 'fastify' { const f: any; export default f; }
declare module 'argon2' { const a: any; export default a; }
declare module '@fastify/cookie' { const a: any; export default a; }
declare module '@fastify/helmet' { const a: any; export default a; }
declare module '@fastify/rate-limit' { const a: any; export default a; }

// ---- Web (sem @types/react, dexie, vite neste ambiente) ----
declare module 'react' {
  export type ReactNode = any;
  export type Dispatch<A> = (v: A) => void;
  export function useState<T>(init: T | (() => T)): [T, (v: T | ((p: T) => T)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  export function useRef<T>(init: T): { current: T };
  export function useRef<T>(init: T | null): { current: T | null };
  export function useId(): string;
  export function useContext<T>(c: Context<T>): T;
  export interface Context<T> { Provider: any; _t?: T }
  export function createContext<T>(d: T): Context<T>;
  export const StrictMode: any;
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react-dom/client' { export function createRoot(el: Element): { render(n: any): void }; }
declare namespace JSX {
  interface Element {}
  interface IntrinsicAttributes { key?: string | number }
  type EV = { target: any; currentTarget: any; key: string; preventDefault(): void; stopPropagation(): void; ctrlKey: boolean; metaKey: boolean };
  interface P {
    [p: string]: any;
    onChange?: (e: EV) => void; onClick?: (e: EV) => void; onKeyDown?: (e: EV) => void; onSubmit?: (e: EV) => void; onBlur?: (e: EV) => void;
    onFocus?: (e: EV) => void; onMouseEnter?: (e: EV) => void; onMouseLeave?: (e: EV) => void; onMouseDown?: (e: EV) => void; onCancel?: (e: EV) => void; onClose?: (e: EV) => void;
  }
  interface IntrinsicElements { [k: string]: P }
}
declare module 'dexie' {
  export interface Table<T, K> {
    get(k: K): Promise<T | undefined>; put(v: T): Promise<unknown>; add(v: T): Promise<unknown>; delete(k: K): Promise<void>; clear(): Promise<void>;
    toArray(): Promise<T[]>; orderBy(i: string): { toArray(): Promise<T[]> };
  }
  export default class Dexie {
    constructor(name: string);
    version(n: number): { stores(s: Record<string, string>): void };
    transaction(mode: string, ...rest: any[]): Promise<void>;
  }
}
declare module 'virtual:pwa-register' { export function registerSW(o?: any): (reload?: boolean) => Promise<void>; }
declare module '*.css';
declare module 'vite' { export function defineConfig(c: any): any; }
declare module '@vitejs/plugin-react' { const p: any; export default p; }
declare module 'vite-plugin-pwa' { export const VitePWA: any; }
