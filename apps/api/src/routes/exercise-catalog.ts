import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import {
  EXERCISE_BODY_PARTS,
  MAX_EXERCISE_SEARCH_LENGTH,
  type ExerciseCatalogDetail,
  type ExerciseCatalogItem,
  type ExerciseCatalogListResponse,
} from "@kinora/contracts";
import {
  getExerciseById,
  listExercises,
  tallyExerciseFacets,
  type ExerciseCatalogFilters,
  type ExerciseCatalogRecord,
  type ExerciseFacetFilters,
  type ExerciseFacetTally,
} from "@kinora/exercise-catalog";

/**
 * Exercise-library read API (exercise-library slice, API layer).
 *
 *   GET /exercises/catalog        → 200 ExerciseCatalogListResponse | 400 bad query
 *   GET /exercises/catalog/:id    → 200 ExerciseCatalogDetail       | 404 unknown id
 *   GET /exercises/catalog/facets → 200 ExerciseCatalogFacets
 *
 * The catalog is STATIC, read-only reference data shipped inside
 * `@kinora/exercise-catalog` — it is not in Postgres and is NOT tenant-scoped,
 * so there is no route port to inject: the module IS the source of truth and
 * every handler is a pure projection of it (no `db/*` import, dep-cruiser
 * `routes-no-db-layer` holds trivially).
 *
 * Auth still applies. `requireAuth()` matches every sibling read route mounted
 * next to it (e.g. `/progress/exercise-detail`); the library is in-app product
 * content, not a public asset, so it is not exposed anonymously.
 */

/** Default page size — one full grid page in the web client. */
export const DEFAULT_CATALOG_LIMIT = 24;
/** Hard cap on `limit`, so one request can never fan out the whole catalog. */
export const MAX_CATALOG_LIMIT = 100;
/**
 * Upper bound on free-text `search`, mirroring `admin-logs.ts`'s event filter.
 *
 * Imported from `@kinora/contracts` rather than declared here: the web library
 * truncates against the SAME constant, so lowering the cap can no longer leave
 * that side sending terms this route rejects.
 */
const MAX_SEARCH_LENGTH = MAX_EXERCISE_SEARCH_LENGTH;

/** A distinct facet value plus how many catalog records carry it. */
export interface ExerciseCatalogFacetValue {
  value: string;
  count: number;
}

/**
 * Distinct filter values for the three exact-match filters, each with counts.
 * Keys are named after the query parameters they feed (`bodyPart`, `equipment`,
 * `target`) so the client can build a filter control without shipping — or
 * scanning — the whole catalog.
 */
export interface ExerciseCatalogFacets {
  bodyPart: ExerciseCatalogFacetValue[];
  equipment: ExerciseCatalogFacetValue[];
  target: ExerciseCatalogFacetValue[];
}

/**
 * Coerce one raw query value into a list: `undefined` → `[]` (key absent),
 * a single string → a one-element list (Fastify hands a bare string for one
 * occurrence), an array is passed through (Fastify hands an array for a
 * repeated key).
 */
function toList(raw: unknown): unknown[] {
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

/**
 * Builds a `z.array(item)` schema fed by a preprocessor that trims, drops
 * blanks and de-duplicates BEFORE `item` validates each entry. This is what
 * makes a blank value (`?bodyPart=`) resolve to an empty, unconstrained list
 * instead of failing validation — the same shield that stops a repeated
 * blank-then-value parameter (`?search=&search=press`, issue #343) from ever
 * reaching a 500 is extended here to the array case.
 */
function valueList<T extends z.ZodTypeAny>(item: T) {
  return z
    .preprocess((raw) => {
      const seen = new Set<string>();
      return toList(raw)
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "" && !seen.has(entry) && (seen.add(entry), true));
    }, z.array(item))
    .optional();
}

/**
 * `search` stays single-valued — it is NOT widened into an OR-membership list
 * like the other three fields. A repeated key (`?search=&search=press`, issue
 * #343) is collapsed to its first non-blank entry before validation, so it
 * never reaches the catalog as a 500 or a spurious 400; a single (non-array)
 * blank value is passed through UNCHANGED and still fails `min(1)` (→ 400,
 * unchanged contract).
 */
function collapseRepeatedSearch(raw: unknown): unknown {
  if (!Array.isArray(raw)) {
    return raw;
  }
  return raw.find((entry) => typeof entry === "string" && entry.trim() !== "");
}

/**
 * The filter fields shared by the list and facets endpoints. `bodyPart` stays
 * an enum — an unrecognized value still fails validation (→ 400), preserving
 * today's contract. `equipment`/`target` are free-form: an unrecognized value
 * is accepted and simply matches nothing.
 */
const filterFieldsSchema = z.object({
  search: z.preprocess(
    collapseRepeatedSearch,
    z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
  ),
  bodyPart: valueList(z.enum(EXERCISE_BODY_PARTS)),
  equipment: valueList(z.string()),
  target: valueList(z.string()),
});

/**
 * Zod schema for the raw list query string. Every field is optional; a present
 * but malformed value fails the parse (→ 400). `limit`/`offset` arrive as
 * strings and are coerced to non-negative integers here — `limit` is then
 * CLAMPED to {@link MAX_CATALOG_LIMIT} rather than rejected, so an over-eager
 * client gets a capped page instead of an error.
 */
const listQuerySchema = filterFieldsSchema
  .extend({
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number(value))
      .optional(),
    offset: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number(value))
      .optional(),
  })
  .strip();

/** Same schema minus the pagination window — used by `/exercises/catalog/facets`. */
const facetQuerySchema = filterFieldsSchema.strip();

/** Builds the filter-dimension part of the parsed query, shared by both endpoints. */
function buildFacetFilters(
  parsed: z.infer<typeof filterFieldsSchema>,
): ExerciseFacetFilters {
  const filters: ExerciseFacetFilters = {};
  if (parsed.search) filters.search = parsed.search;
  if (parsed.bodyPart && parsed.bodyPart.length > 0) filters.bodyPart = parsed.bodyPart;
  if (parsed.equipment && parsed.equipment.length > 0) filters.equipment = parsed.equipment;
  if (parsed.target && parsed.target.length > 0) filters.target = parsed.target;
  return filters;
}

/** The applied window echoed back on the response alongside the filters used. */
interface PlannedCatalogQuery {
  filters: ExerciseCatalogFilters;
  limit: number;
  offset: number;
}

export type PlanCatalogQueryResult =
  | { ok: true; query: PlannedCatalogQuery }
  | { ok: false };

/**
 * Pure query-string validator/planner. Returns `{ ok: false }` for ANY invalid
 * input (unknown body part, blank/oversized search, non-numeric or negative
 * limit/offset) so the route can map it to 400 without touching the catalog.
 * Kept pure so it is unit-testable without a Fastify request.
 */
export function planCatalogQuery(raw: unknown): PlanCatalogQueryResult {
  const parsed = listQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false };
  }
  const { limit, offset } = parsed.data;

  const appliedLimit = Math.min(limit ?? DEFAULT_CATALOG_LIMIT, MAX_CATALOG_LIMIT);
  const appliedOffset = offset ?? 0;

  const filters: ExerciseCatalogFilters = {
    ...buildFacetFilters(parsed.data),
    limit: appliedLimit,
    offset: appliedOffset,
  };

  return { ok: true, query: { filters, limit: appliedLimit, offset: appliedOffset } };
}

export type PlanFacetQueryResult =
  | { ok: true; filters: ExerciseFacetFilters }
  | { ok: false };

/** Pure query-string validator/planner for the facets endpoint — no pagination window. */
export function planFacetQuery(raw: unknown): PlanFacetQueryResult {
  const parsed = facetQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, filters: buildFacetFilters(parsed.data) };
}

/**
 * Project a catalog record onto the lean list item. `secondaryMuscles` and the
 * heavy `instructionSteps` payload are dropped; `attribution` is NEVER dropped
 * — the media it covers is © Gym visual and its notice must travel with it.
 */
function toListItem(record: ExerciseCatalogRecord): ExerciseCatalogItem {
  return {
    id: record.id,
    name: record.name,
    bodyPart: record.bodyPart,
    equipment: record.equipment,
    target: record.target,
    muscleGroup: record.muscleGroup,
    imagePath: record.imagePath,
    gifPath: record.gifPath,
    attribution: record.attribution,
  };
}

/** Project a catalog record onto the full detail DTO (list item + heavy fields). */
function toDetail(record: ExerciseCatalogRecord): ExerciseCatalogDetail {
  return {
    ...toListItem(record),
    secondaryMuscles: record.secondaryMuscles,
    instructionSteps: {
      en: record.instructionSteps.en,
      es: record.instructionSteps.es,
    },
  };
}

/** Same (count desc, value asc) order `tallyExerciseFacets` uses internally. */
function compareFacetTally(a: ExerciseFacetTally, b: ExerciseFacetTally): number {
  if (a.count !== b.count) {
    return b.count - a.count;
  }
  return a.value.localeCompare(b.value);
}

/**
 * Unions a computed tally with the caller's current selection: any selected
 * value the tally omits (its count under the OTHER active filters is zero) is
 * appended at `count: 0` so it stays visible and checked in the response,
 * then the whole group is re-sorted — zero-count entries land last, ordered
 * alphabetically among themselves.
 */
function mergeSelected(
  tally: readonly ExerciseFacetTally[],
  selected: readonly string[] | undefined,
): ExerciseCatalogFacetValue[] {
  if (!selected || selected.length === 0) {
    return [...tally];
  }
  const byValue = new Map(tally.map((entry) => [entry.value, entry] as const));
  for (const value of selected) {
    if (!byValue.has(value)) {
      byValue.set(value, { value, count: 0 });
    }
  }
  return [...byValue.values()].sort(compareFacetTally);
}

/**
 * Result-scoped facet counts for the given filters. Recomputed on every call
 * — the catalog is a frozen 1,324-record dataset, so a fresh scan is
 * sub-millisecond and there is no correctness upside to caching results that
 * vary per request (there is no longer a single "the" facets result once
 * filters can shape it).
 */
export function computeExerciseCatalogFacets(
  filters: ExerciseFacetFilters = {},
): ExerciseCatalogFacets {
  const tally = tallyExerciseFacets(filters);
  return {
    bodyPart: mergeSelected(tally.bodyPart, filters.bodyPart),
    equipment: mergeSelected(tally.equipment, filters.equipment),
    target: mergeSelected(tally.target, filters.target),
  };
}

export const exerciseCatalogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/exercises/catalog",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const plan = planCatalogQuery(request.query ?? {});
      if (!plan.ok) {
        return reply.code(400).send({ error: "invalid_query" });
      }

      const page = listExercises(plan.query.filters);
      const body: ExerciseCatalogListResponse = {
        items: page.items.map(toListItem),
        total: page.total,
        limit: plan.query.limit,
        offset: plan.query.offset,
      };
      return reply.code(200).send(body);
    },
  );

  /**
   * Registered BEFORE `/exercises/catalog/:id` for readability only — Fastify's
   * radix router always prefers the static segment over the parametric one, so
   * `facets` can never be swallowed as an id.
   */
  fastify.get(
    "/exercises/catalog/facets",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const plan = planFacetQuery(request.query ?? {});
      if (!plan.ok) {
        return reply.code(400).send({ error: "invalid_query" });
      }
      return reply.code(200).send(computeExerciseCatalogFacets(plan.filters));
    },
  );

  fastify.get(
    "/exercises/catalog/:id",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const record = getExerciseById(id);
      if (!record) {
        return reply.code(404).send({ error: "exercise_not_found" });
      }
      return reply.code(200).send(toDetail(record));
    },
  );
};
