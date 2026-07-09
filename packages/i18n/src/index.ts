/**
 * `@kinora/i18n` — single source of truth for EN/ES ICU message catalogs,
 * shared by web (next-intl) and mobile (react-intl).
 *
 * Slice 1 ships this package's MACHINERY proven against a small sample
 * catalog (`messages/en.json` / `messages/es.json`). The full 325-key
 * production catalog data lands in slice 2 without changing this surface.
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

export type SampleMessageKey = MessageKeys<typeof en>;
