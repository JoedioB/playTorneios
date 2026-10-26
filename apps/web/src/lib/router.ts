import { useEffect, useState } from 'react';

/** Roteador mínimo por hash (funciona offline e sem configuração de servidor). */
export function parseHash(hash: string): { path: string[]; query: URLSearchParams } {
  const raw = hash.replace(/^#/, '') || '/';
  const [p, q] = raw.split('?');
  return { path: (p as string).split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}

export function useRoute(): { path: string[]; query: URLSearchParams } {
  const [h, setH] = useState(() => (typeof location === 'undefined' ? '' : location.hash));
  useEffect(() => {
    const on = () => setH(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return parseHash(h);
}

export const go = (to: string): void => {
  location.hash = to.startsWith('#') ? to : `#${to}`;
};
