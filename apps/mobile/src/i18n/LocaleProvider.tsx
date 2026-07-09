/**
 * `LocaleProvider` — mounts react-intl's `IntlProvider` at the app root,
 * seeded from the SAME shared `@kinora/i18n` catalogs web consumes, and
 * exposes a `useLocale()` hook so any screen can switch the active locale
 * at runtime without prop-drilling `messages` or restarting the app.
 *
 * Thin framework glue over the pure `resolveMessages`/`createLocaleStore`
 * modules — mirrors the rest of this app's "pure logic + thin glue" split
 * (see `App.tsx`'s doc comment).
 */
import React, { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { IntlProvider } from "react-intl";
import { createLocaleStore } from "./locale-store.js";
import { DEFAULT_LOCALE, resolveMessages, type SupportedLocale } from "./locale.js";

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: SupportedLocale;
}) {
  // One store per provider instance (mirrors useState(() => …) semantics)
  // so it survives re-renders but is fresh per mount.
  const store = useMemo(() => createLocaleStore(initialLocale), [initialLocale]);
  const locale = useSyncExternalStore(store.subscribe, store.getLocale);
  const messages = useMemo(() => resolveMessages(locale), [locale]);

  const contextValue = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale: store.setLocale }),
    [locale, store]
  );

  return (
    <IntlProvider locale={locale} defaultLocale={DEFAULT_LOCALE} messages={messages}>
      <LocaleContext.Provider value={contextValue}>{children}</LocaleContext.Provider>
    </IntlProvider>
  );
}

/** Access the active locale + its setter from anywhere under `LocaleProvider`. */
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return value;
}
