/**
 * Pure query-string helpers for the exercise library grid.
 *
 * They live outside `page.tsx` because a Next.js App Router route module may
 * only export the framework's own reserved names — any extra export fails the
 * generated route type-check.
 */

/** How many cards one library page shows. */
export const EXERCISE_PAGE_SIZE = 24;

/** The library's URL-driven state, as read from `searchParams`. */
export interface ExerciseLibraryParams {
  title?: string;
  search?: string;
  bodyPart?: string;
  equipment?: string;
  target?: string;
  offset?: string;
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
  const preserved: Record<string, string> = {};
  for (const key of ["title", "bodyPart", "equipment", "target"] as const) {
    const value = params[key];
    if (value) preserved[key] = value;
  }
  return preserved;
}

/** Coerce `?offset=` to a non-negative integer; anything else means page one. */
export function parseOffset(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

/** Build a pager link that keeps the active search, filters and selection. */
export function pageHref(params: ExerciseLibraryParams, offset: number): string {
  const query = new URLSearchParams();
  for (const key of ["title", "search", "bodyPart", "equipment", "target"] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  if (offset > 0) query.set("offset", String(offset));
  const serialized = query.toString();
  return serialized ? `/exercises?${serialized}` : "/exercises";
}
