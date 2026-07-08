/**
 * Recursively derives the union of dot-joined leaf-key paths from a nested
 * message catalog shape, e.g. `{ nav: { home: string } }` -> `"nav.home"`.
 * This is the generated key type consuming code MUST reference message keys
 * through, so an unknown key is a type error rather than a runtime miss.
 */
export type MessageKeys<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? `${K}` : `${K}.${MessageKeys<T[K]>}`;
    }[keyof T & string];
