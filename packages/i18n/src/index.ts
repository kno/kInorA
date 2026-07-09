/**
 * `@kinora/i18n` — single source of truth for EN/ES ICU message catalogs,
 * shared by web (next-intl) and mobile (react-intl).
 *
 * Slice 1 shipped this package's MACHINERY proven against a small sample
 * catalog. Slice 2 replaces `messages/en.json` / `messages/es.json` with the
 * full production catalog (325 leaf keys, migrated from
 * `apps/web/src/i18n/messages/{en,es}.json`) without changing this surface.
 */
import en from "./messages/en.json";
import es from "./messages/es.json";

export { flattenMessages } from "./flatten.js";
export type { NestedMessages } from "./flatten.js";

export { mergeWithBase } from "./merge.js";

export { validateCatalogParity } from "./catalog-parity.js";
export type { ParityResult } from "./catalog-parity.js";

import type { MessageKeys } from "./types.js";
export type { MessageKeys } from "./types.js";

export const catalogs = { en, es } as const;

/**
 * The full union of dot-joined message-key paths, derived directly from the
 * shipped EN catalog shape (no manual enumeration) — referencing an unknown
 * key anywhere consuming code uses `MessageKey` is a compile-time error.
 */
export type MessageKey = MessageKeys<typeof en>;
