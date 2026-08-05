/**
 * How a multi-select facet's values are written into ONE query parameter.
 *
 * The obvious encoding for "OR within a group" is a repeated key —
 * `?bodyPart=chest&bodyPart=cardio` — which is exactly what a native
 * multi-checkbox `<form method="get">` submits, and what the API itself
 * accepts. The library still READS that form (see `normalizeLibraryParams`),
 * because the no-JS submit is a first-class path and cannot produce anything
 * else.
 *
 * What the library must never PUSH, though, is a URL where one key appears
 * twice, because Next.js' client router cannot tell two such URLs apart.
 * `getCacheKeyForDynamicParam` (next/dist/client/route-params.js, 16.2.9)
 * builds the page segment's cache key with
 *
 *     Object.fromEntries(new URLSearchParams(renderedSearch))
 *
 * and `Object.fromEntries` keeps only the LAST occurrence of a repeated key.
 * So `?bodyPart=cardio` and `?bodyPart=chest&bodyPart=cardio` both key as
 * `__PAGE__?{"bodyPart":"cardio"}`. A soft navigation between them fetches the
 * correct RSC payload and then throws it away, reusing the cached segment: the
 * URL changes, the checkboxes change, and the results do not. (The sibling
 * helper `urlSearchParamsToParsedUrlQuery`, right below it in the same file,
 * handles repeats correctly — the page-segment key simply does not use it.)
 *
 * Joining the values into a single occurrence makes the collapse lossless, so
 * every distinct selection gets a distinct cache key. It is a URL-shape choice
 * this app owns, not a workaround layered over the router.
 *
 * A comma is safe as the separator here: it is a legal, unescaped URL query
 * character, and no catalog `bodyPart`/`equipment`/`target` value contains one
 * (`bodyPart` is additionally enum-validated against `EXERCISE_BODY_PARTS`).
 * A value that did contain one would round-trip as two values, each of which
 * simply matches nothing — a narrower result, never a crash.
 *
 * Kept in its own tiny module — with no dependencies — so BOTH the server-side
 * query helpers and the client `ExerciseLibraryControls` can share one
 * definition. `library-query.ts` pulls in `@kinora/contracts`, which has no
 * business in the browser bundle.
 */
export const FACET_VALUE_SEPARATOR = ",";

/**
 * Collapse one facet group's selected values into a single query-parameter
 * value. An empty selection yields `""`, which callers must omit entirely
 * rather than write as `?bodyPart=`.
 */
export function joinFacetValues(values: readonly string[]): string {
  return values.join(FACET_VALUE_SEPARATOR);
}

/**
 * Every non-blank, de-duplicated value carried by one facet parameter, in the
 * order given.
 *
 * Accepts BOTH shapes the library can receive: the joined form it writes
 * itself, and the repeated-key form a native form submit (or a hand-written
 * URL, or a link shared from before this encoding existed) produces — hence
 * the `string[]` branch.
 */
export function splitFacetValues(raw: string | string[] | undefined): string[] {
  const occurrences = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: string[] = [];
  for (const occurrence of occurrences) {
    if (typeof occurrence !== "string") continue;
    for (const part of occurrence.split(FACET_VALUE_SEPARATOR)) {
      const trimmed = part.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}
