import "server-only";

import {
  ExerciseCatalogDetailSchema,
  ExerciseCatalogListResponseSchema,
  type ExerciseCatalogDetail,
  type ExerciseCatalogListResponse,
} from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

/** Filters accepted by the catalog list endpoint. Every field is optional. */
export interface ExerciseCatalogQuery {
  search?: string;
  bodyPart?: string;
  equipment?: string;
  target?: string;
  limit?: number;
  offset?: number;
}

export type FetchExerciseCatalogListResult =
  | { kind: "ok"; page: ExerciseCatalogListResponse }
  | { kind: "error"; message: string };

export type FetchExerciseCatalogDetailResult =
  | { kind: "ok"; exercise: ExerciseCatalogDetail }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

/** One distinct facet value plus how many catalog records carry it. */
export interface ExerciseCatalogFacetValue {
  value: string;
  count: number;
}

/** Distinct filterable values, grouped by the field they filter. */
export interface ExerciseCatalogFacets {
  bodyPart: ExerciseCatalogFacetValue[];
  equipment: ExerciseCatalogFacetValue[];
  target: ExerciseCatalogFacetValue[];
}

export type FetchExerciseCatalogFacetsResult =
  | { kind: "ok"; facets: ExerciseCatalogFacets }
  | { kind: "error"; message: string };

/**
 * Fetch a page of the exercise library via `GET /exercises/catalog`.
 *
 * The catalog holds ~1300 records, so the browser NEVER receives the whole
 * set: search, filtering and pagination are query parameters resolved by the
 * API and only the requested window crosses the wire. Mirrors
 * `fetchExerciseDetail` — a plain read through the session-cookie-
 * authenticated API path, with a typed result union instead of throws.
 */
export async function fetchExerciseCatalogList(
  token: string | undefined,
  query: ExerciseCatalogQuery = {},
  options: ClientOptions = {}
): Promise<FetchExerciseCatalogListResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;
  const search = buildCatalogQueryString(query);

  let res: Response;
  try {
    res = await fetchImpl(`${base}/exercises/catalog${search}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_exercise_catalog_failed" };
  }

  const body = await res.json().catch(() => null);
  const parsed = ExerciseCatalogListResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", page: parsed.data };
}

/**
 * Segments mounted UNDER `/exercises/catalog/` that are not exercise ids.
 *
 * `/exercises/facets` reaches this function with `id="facets"`, which builds
 * the facets URL — the API answers 200 with the facets object, the detail
 * schema then fails to parse, and the reader is told the library is
 * unavailable. There is no such exercise: it is a 404.
 */
const RESERVED_CATALOG_SEGMENTS = new Set(["facets"]);

/**
 * Fetch one exercise's full detail via `GET /exercises/catalog/:id`.
 *
 * A 404 is a distinct `"not-found"` result rather than a generic error so the
 * route can render Next.js' own not-found page instead of an error card.
 */
export async function fetchExerciseCatalogDetail(
  token: string | undefined,
  id: string,
  options: ClientOptions = {}
): Promise<FetchExerciseCatalogDetailResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  if (!id || RESERVED_CATALOG_SEGMENTS.has(id)) {
    return { kind: "not-found" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/exercises/catalog/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (res.status === 404) {
    return { kind: "not-found" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_exercise_catalog_failed" };
  }

  const body = await res.json().catch(() => null);
  const parsed = ExerciseCatalogDetailSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", exercise: parsed.data };
}

/**
 * Fetch the distinct filter values via `GET /exercises/catalog/facets`.
 *
 * The facet payload is small and purely presentational (it only decides which
 * filter chips are offered), so an unparseable or missing group degrades to an
 * empty list rather than failing the page.
 */
export async function fetchExerciseCatalogFacets(
  token: string | undefined,
  options: ClientOptions = {}
): Promise<FetchExerciseCatalogFacetsResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/exercises/catalog/facets`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_exercise_facets_failed" };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  // `typeof [] === "object"`, so an ARRAY body used to pass this guard: every
  // group normalised to `[]` and the result was reported as `kind: "ok"`. The
  // reader then lost every filter chip with no error anywhere — a wrong page
  // that looks perfectly fine. Only a plain object can carry facet groups.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  const groups = body as Record<string, unknown>;
  return {
    kind: "ok",
    facets: {
      bodyPart: normalizeFacetValues(groups.bodyPart),
      equipment: normalizeFacetValues(groups.equipment),
      target: normalizeFacetValues(groups.target),
    },
  };
}

/**
 * Coerce one filter value to a usable string, or drop it.
 *
 * DEFENCE IN DEPTH. The types say `string | undefined`, but the values
 * originate in a URL: a repeated key (`?search=a&search=b`) reaches the page as
 * an ARRAY, and calling `.trim()` on that threw a TypeError outside any
 * try/catch — the whole page answered HTTP 500. Callers normalise upstream now;
 * this makes the crash site itself unable to throw, rather than depending on
 * every future caller remembering to. An array collapses to its first non-blank
 * entry, matching `normalizeLibraryParams`.
 */
function filterValue(raw: unknown): string | undefined {
  if (Array.isArray(raw)) {
    return filterValue(raw.find((entry) => typeof entry === "string" && entry.trim() !== ""));
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/** Serialize the filter/pagination window, omitting blank values. */
export function buildCatalogQueryString(query: ExerciseCatalogQuery): string {
  const params = new URLSearchParams();

  for (const key of ["search", "bodyPart", "equipment", "target"] as const) {
    const value = filterValue(query[key]);
    if (value) params.set(key, value);
  }
  if (typeof query.limit === "number") params.set("limit", String(query.limit));
  if (typeof query.offset === "number") params.set("offset", String(query.offset));

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * Coerce one facet group into `{ value, count }[]`, dropping anything that
 * does not carry a usable label. A group the API omits becomes `[]`.
 */
function normalizeFacetValues(raw: unknown): ExerciseCatalogFacetValue[] {
  if (!Array.isArray(raw)) return [];

  const values: ExerciseCatalogFacetValue[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { value, count } = entry as { value?: unknown; count?: unknown };
    if (typeof value !== "string" || value.length === 0) continue;
    values.push({ value, count: typeof count === "number" ? count : 0 });
  }
  return values;
}
