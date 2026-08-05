/**
 * Pure query-string helpers for the exercise library grid.
 *
 * They live outside `page.tsx` because a Next.js App Router route module may
 * only export the framework's own reserved names — any extra export fails the
 * generated route type-check.
 */

import { EXERCISE_BODY_PARTS, MAX_EXERCISE_SEARCH_LENGTH } from "@kinora/contracts";
import { joinFacetValues, splitFacetValues } from "./facet-values";

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

/** The three facet groups that accept more than one selected value. */
const MULTI_KEYS = new Set(["bodyPart", "equipment", "target"]);

/** The library's URL-driven state, after normalisation. */
export interface ExerciseLibraryParams {
  title?: string;
  search?: string;
  bodyPart?: string[];
  equipment?: string[];
  target?: string[];
  offset?: string;
  /**
   * Any other parameter present on the URL. It is normalised like the rest,
   * but only the ALLOW-LISTED ones (see `CARRIED_KEYS`) are reflected back into
   * the library's own links and hidden fields.
   *
   * Widened to `string | string[]` so the three multi-value facet keys above
   * remain assignable through this index signature too.
   */
  [key: string]: string | string[] | undefined;
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
 * Collapse one raw SINGLE-VALUE parameter (`search`, `title`, `offset`, and
 * anything else outside `MULTI_KEYS`) to a single string, taking the first
 * NON-BLANK value when the key repeats — the same hardening `parseOffset`
 * applies to `?offset=`.
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
 * Every non-blank, de-duplicated value of a MULTI-VALUE parameter
 * (`bodyPart`, `equipment`, `target`), in URL order.
 *
 * Repeat-tolerant by design, unlike `firstValue`: a facet group is additive
 * (OR within the group), so BOTH `?bodyPart=chest,cardio` (the form the
 * library writes) and `?bodyPart=chest&bodyPart=cardio` (the form a native
 * no-JS submit produces) must keep BOTH values rather than collapsing to the
 * first one. See `facet-values.ts` for why the two forms exist. Blanks are
 * still skipped — `?bodyPart=&bodyPart=chest` behaves exactly like the
 * single-value path, so the #343 HTTP 500 shape cannot return through either.
 */
const allValues = splitFacetValues;

/**
 * Normalise `searchParams` at the boundary where the page reads them.
 *
 * Two jobs, both of which stop a hand-written URL from breaking the page:
 *  - a repeated key becomes its first NON-BLANK value for single-value
 *    fields, or every non-blank de-duplicated value for the three facet
 *    fields, so nothing downstream ever gets an array where it expects a
 *    string or a string where it expects a list; and
 *  - a value the API would REJECT is clamped or dropped, so the page degrades
 *    to an ordinary (possibly empty) result instead of the "library
 *    unavailable" card. A genuine API failure still renders that card.
 *
 * Single-value, in-range parameters pass through untouched.
 */
export function normalizeLibraryParams(raw: RawExerciseLibraryParams): ExerciseLibraryParams {
  const params: ExerciseLibraryParams = {};

  for (const [key, value] of Object.entries(raw)) {
    if (MULTI_KEYS.has(key)) continue;
    const single = firstValue(value)?.trim();
    if (single) params[key] = single;
  }

  for (const key of MULTI_KEYS) {
    const values = allValues(raw[key]);
    if (values.length > 0) params[key] = values;
  }

  // The API caps free-text search; a longer term would 400.
  if (typeof params.search === "string" && params.search.length > MAX_EXERCISE_SEARCH_LENGTH) {
    params.search = params.search.slice(0, MAX_EXERCISE_SEARCH_LENGTH);
  }

  // `bodyPart` is an API ENUM (lowercase). An unknown value — `Chest`, say —
  // is not a filter that matches nothing, it is a 400; filter it out of the
  // selection rather than sending it. If none of the selected values survive,
  // the key is omitted entirely (unconstrained), same as if it were absent.
  if (Array.isArray(params.bodyPart)) {
    const known = params.bodyPart.filter((value) =>
      (EXERCISE_BODY_PARTS as readonly string[]).includes(value),
    );
    if (known.length > 0) params.bodyPart = known;
    else delete params.bodyPart;
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
    if (skip.has(key)) continue;
    const value = params[key];
    if (MULTI_KEYS.has(key)) {
      // ONE entry carrying every selected value, never a repeated key — see
      // `facet-values.ts`: a key that appears twice is invisible to Next's
      // client router cache, which silently re-renders the previous results.
      const joined = joinFacetValues((value as string[] | undefined) ?? []);
      if (joined) entries.push([key, joined]);
    } else if (typeof value === "string" && value) {
      entries.push([key, value]);
    }
  }

  // Then the ALLOW-LISTED extras the library does not own but must carry, so
  // the pager and the search form never silently drop the reader's locale.
  // Deliberately not "every remaining key": see CARRIED_KEYS.
  for (const key of CARRIED_KEYS) {
    const value = params[key];
    if (!skip.has(key) && typeof value === "string" && value) entries.push([key, value]);
  }

  return entries;
}

/**
 * The query parameters a search submit must carry through, as hidden form
 * fields.
 *
 * Everything currently active EXCEPT:
 *  - `search`, which the text input itself contributes;
 *  - `offset`, because a new search must land on page 1 rather than stranding
 *    the reader on page 3 of a smaller result set; and
 *  - `bodyPart`/`equipment`/`target`, because the facet checkboxes now live
 *    INSIDE this same `<form>` (design §7) and contribute those themselves —
 *    duplicating them as hidden fields would submit a stale value alongside
 *    the live one.
 *
 * Returns REPEATED-KEY-SAFE `[key, value][]` pairs rather than a `Record`.
 * `Object.fromEntries` silently keeps only the LAST of repeated keys, which is
 * exactly the trap this shape avoids — see `carriedFilterParams` for the
 * multi-value case this return type exists to protect.
 */
export function preservedSearchParams(
  params: ExerciseLibraryParams
): [string, string][] {
  return activeEntries(params, ["search", "offset", "bodyPart", "equipment", "target"]);
}

/**
 * The query parameters the CLEAR-FILTERS LINK must carry, as a base to
 * mutate.
 *
 * Everything currently active EXCEPT `offset`, because clearing the filters
 * changes the result set and must land on page 1.
 *
 * Unlike {@link preservedSearchParams} this KEEPS `search` AND the facet
 * fields: the clear-filters `href` is a complete destination URL, not a form
 * other controls also contribute to.
 *
 * Returns `[key, value][]` rather than a `Record<string,string>` for the same
 * reason {@link preservedSearchParams} does: an ordered pair list is the shape
 * every caller can hand straight to `URLSearchParams` without a lossy detour
 * through `Object.fromEntries`.
 */
export function carriedFilterParams(params: ExerciseLibraryParams): [string, string][] {
  return activeEntries(params, ["offset"]);
}

/**
 * Whether the incoming raw parameters carry the SAME key more than once.
 *
 * The App Router hands a repeated key through as an array, so that is the
 * whole test. A URL in this shape is legal and fully readable (see
 * `allValues`), but it is NOT the library's canonical form, and Next's client
 * router cannot distinguish it from a URL that merely shares its last value —
 * see `facet-values.ts`. `page.tsx` redirects such a URL to
 * {@link canonicalLibraryHref} so only one shape is ever live in the browser.
 */
export function hasRepeatedKey(raw: RawExerciseLibraryParams): boolean {
  return Object.values(raw).some((value) => Array.isArray(value));
}

/**
 * The canonical `/exercises?…` URL for an already-normalised parameter set:
 * every key exactly once, multi-select facets joined.
 *
 * Unlike {@link carriedFilterParams} this keeps EVERYTHING the reader's URL
 * carried, `offset` and unrecognised parameters included — it is a
 * canonicalisation of the reader's own address, not one of the library's
 * generated links, so dropping anything would silently lose their place.
 *
 * IDEMPOTENT by construction, which is what makes it safe to redirect to: its
 * output has no repeated key, so feeding it back through
 * `normalizeLibraryParams` + `hasRepeatedKey` never asks for another redirect.
 */
export function canonicalLibraryHref(params: ExerciseLibraryParams): string {
  const query = new URLSearchParams();
  const written = new Set<string>();

  for (const key of LIBRARY_KEYS) {
    const value = params[key];
    if (MULTI_KEYS.has(key)) {
      const joined = joinFacetValues((value as string[] | undefined) ?? []);
      if (joined) query.set(key, joined);
    } else if (typeof value === "string" && value) {
      query.set(key, value);
    }
    written.add(key);
  }

  for (const [key, value] of Object.entries(params)) {
    if (written.has(key)) continue;
    if (typeof value === "string" && value) query.set(key, value);
  }

  const serialized = query.toString();
  return serialized ? `/exercises?${serialized}` : "/exercises";
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
