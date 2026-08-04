/**
 * Pure query-string helpers for the exercise library grid.
 *
 * They live outside `page.tsx` because a Next.js App Router route module may
 * only export the framework's own reserved names — any extra export fails the
 * generated route type-check.
 */

import { EXERCISE_BODY_PARTS, MAX_EXERCISE_SEARCH_LENGTH } from "@kinora/contracts";

/** How many cards one library page shows. */
export const EXERCISE_PAGE_SIZE = 24;

/**
 * Longest `?search=` the API accepts. A longer term is TRUNCATED here rather
 * than sent, because the API answers 400 and the page would then claim the
 * library is unavailable when it is perfectly available.
 *
 * Re-exported from `@kinora/contracts` — the API route validates against the
 * SAME constant, exactly as both sides share `EXERCISE_BODY_PARTS`. A local
 * copy could drift the moment the API lowered its cap.
 */
export { MAX_EXERCISE_SEARCH_LENGTH };

/**
 * Highest `?offset=` we forward. The catalog holds ~1300 records, so anything
 * beyond this is a hand-edited URL; clamping keeps `String(offset)` a plain
 * digit string (`1e+21` fails the API's `^\d+$` regex → 400 → error card).
 */
export const MAX_EXERCISE_OFFSET = 100_000;

/**
 * The raw shape Next's App Router hands to a page: a key REPEATED in the URL
 * (`?search=a&search=b`) arrives as an array, not a string.
 */
export type RawExerciseLibraryParams = Record<string, string | string[] | undefined>;

/** The library's URL-driven state, after normalisation. */
export interface ExerciseLibraryParams {
  title?: string;
  search?: string;
  bodyPart?: string;
  equipment?: string;
  target?: string;
  offset?: string;
  /**
   * Any other parameter present on the URL. It is normalised like the rest,
   * but only the ALLOW-LISTED ones (see `CARRIED_KEYS`) are reflected back into
   * the library's own links and hidden fields.
   */
  [key: string]: string | undefined;
}

/**
 * The parameters the library itself owns, in the order links serialize them.
 * Everything else on the URL is preserved but appended after these.
 */
const LIBRARY_KEYS = ["title", "search", "bodyPart", "equipment", "target"] as const;

/**
 * Parameters the library does not own but DOES carry through its own links and
 * hidden form fields.
 *
 * An explicit allow-list, not "everything else": echoing every unrelated
 * parameter turned `?utm_source=newsletter` into a hidden input and a pager
 * link, so arbitrary third-party query junk became part of the page's own
 * markup. `lang` is here because dropping it would silently switch the reader's
 * locale on page 2 while the filter chips (which copy the whole query string)
 * kept it — the same screen contradicting itself.
 */
const CARRIED_KEYS = ["lang"] as const;

/**
 * Collapse one raw parameter to a single string, taking the first NON-BLANK
 * value when the key repeats — the same hardening `parseOffset` applies to
 * `?offset=`.
 *
 * Blank-first matters: `?search=&search=press` reaches the page as
 * `["", "press"]`, and returning `raw[0]` there dropped the filter and answered
 * with the whole unfiltered library. A quiet wrong answer is worse than the
 * crash this normalisation replaced, so the blank is skipped; an array of only
 * blanks still means "no filter".
 */
function firstValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) {
    return raw.find((entry) => typeof entry === "string" && entry.trim() !== "");
  }
  return typeof raw === "string" ? raw : undefined;
}

/**
 * Normalise `searchParams` at the boundary where the page reads them.
 *
 * Two jobs, both of which stop a hand-written URL from breaking the page:
 *  - a repeated key becomes its first NON-BLANK value, so nothing downstream
 *    ever gets an array where it expects a string, and `?search=&search=press`
 *    still filters; and
 *  - a value the API would REJECT is clamped or dropped, so the page degrades
 *    to an ordinary (possibly empty) result instead of the "library
 *    unavailable" card. A genuine API failure still renders that card.
 *
 * Single-value, in-range parameters pass through untouched.
 */
export function normalizeLibraryParams(raw: RawExerciseLibraryParams): ExerciseLibraryParams {
  const params: ExerciseLibraryParams = {};

  for (const [key, value] of Object.entries(raw)) {
    const single = firstValue(value)?.trim();
    if (single) params[key] = single;
  }

  // The API caps free-text search; a longer term would 400.
  if (params.search && params.search.length > MAX_EXERCISE_SEARCH_LENGTH) {
    params.search = params.search.slice(0, MAX_EXERCISE_SEARCH_LENGTH);
  }

  // `bodyPart` is an API ENUM (lowercase). An unknown value — `Chest`, say —
  // is not a filter that matches nothing, it is a 400; drop it instead.
  if (params.bodyPart && !(EXERCISE_BODY_PARTS as readonly string[]).includes(params.bodyPart)) {
    delete params.bodyPart;
  }

  return params;
}

/** Serialize the active parameters, minus `exclude`, in a stable order. */
function activeEntries(
  params: ExerciseLibraryParams,
  exclude: readonly string[]
): [string, string][] {
  const skip = new Set(exclude);
  const entries: [string, string][] = [];

  for (const key of LIBRARY_KEYS) {
    const value = params[key];
    if (value && !skip.has(key)) entries.push([key, value]);
  }

  // Then the ALLOW-LISTED extras the library does not own but must carry, so
  // the pager and the search form never silently drop the reader's locale.
  // Deliberately not "every remaining key": see CARRIED_KEYS.
  for (const key of CARRIED_KEYS) {
    const value = params[key];
    if (value && !skip.has(key)) entries.push([key, value]);
  }

  return entries;
}

/**
 * The query parameters a search submit must carry through, as hidden form
 * fields.
 *
 * Everything currently active EXCEPT:
 *  - `search`, which the text input itself contributes; and
 *  - `offset`, because a new search must land on page 1 rather than stranding
 *    the reader on page 3 of a smaller result set.
 *
 * Blank values are dropped so the form never emits `?bodyPart=`.
 */
export function preservedSearchParams(
  params: ExerciseLibraryParams
): Record<string, string> {
  return Object.fromEntries(activeEntries(params, ["search", "offset"]));
}

/**
 * Coerce `?offset=` to a non-negative integer; anything else means page one.
 *
 * Only a plain digit string is accepted, and the result is bounded — see
 * {@link MAX_EXERCISE_OFFSET}.
 */
export function parseOffset(raw: string | undefined): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return 0;
  return Math.min(Number(raw), MAX_EXERCISE_OFFSET);
}

/** Build a pager link that keeps the active search, filters and selection. */
export function pageHref(params: ExerciseLibraryParams, offset: number): string {
  const query = new URLSearchParams(activeEntries(params, ["offset"]));
  if (offset > 0) query.set("offset", String(offset));
  const serialized = query.toString();
  return serialized ? `/exercises?${serialized}` : "/exercises";
}
