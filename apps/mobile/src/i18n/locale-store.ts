/**
 * Locale store — pure observer/store for runtime locale switching.
 *
 * Framework-free by design (no React import) so the switching logic itself
 * is directly unit-tested, same "pure logic + thin glue" split used
 * throughout this app (see `App.tsx`'s doc comment). `LocaleProvider.tsx` is
 * the only consumer, wiring this into React via `useSyncExternalStore`.
 */
import { DEFAULT_LOCALE, type SupportedLocale } from "./locale.js";

export type LocaleStore = {
  getLocale: () => SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createLocaleStore(initial: SupportedLocale = DEFAULT_LOCALE): LocaleStore {
  let locale = initial;
  const listeners = new Set<() => void>();

  return {
    getLocale: () => locale,
    setLocale: (next) => {
      if (next === locale) return;
      locale = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
