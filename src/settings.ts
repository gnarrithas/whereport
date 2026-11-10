import { useEffect, useState } from 'react';

/** Auto follows the system's light or dark setting. */
export type Theme = 'auto' | 'light' | 'dark';

/** A setting remembered in localStorage under `whereport:<key>`; the fallback when unset, invalid or unavailable. */
export function useSetting<T extends string | boolean>(key: string, fallback: T, valid: (v: unknown) => v is T) {
  const storageKey = `whereport:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return fallback;
      // Booleans are stored as '1'/'0', as earlier versions did.
      const parsed = typeof fallback === 'boolean' ? raw === '1' : raw;
      return valid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, typeof value === 'boolean' ? (value ? '1' : '0') : value);
    } catch (err) {
      console.warn(`Could not save ${storageKey}`, err);
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
export const isTheme = (v: unknown): v is Theme => v === 'auto' || v === 'light' || v === 'dark';

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Whether the page should be dark: the theme, or the system's preference (followed live) for auto. */
export function useDark(theme: Theme): boolean {
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches);
  useEffect(() => {
    const query = darkQuery();
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const dark = theme === 'dark' || (theme === 'auto' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return dark;
}
