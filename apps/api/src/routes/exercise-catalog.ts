import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import {
  EXERCISE_BODY_PARTS,
  type ExerciseCatalogDetail,
  type ExerciseCatalogItem,
  type ExerciseCatalogListResponse,
} from "@kinora/contracts";
import {
  getExerciseById,
  listExercises,
  type ExerciseCatalogFilters,
  type ExerciseCatalogRecord,
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
/** Upper bound on free-text `search`, mirroring `admin-logs.ts`'s event filter. */
const MAX_SEARCH_LENGTH = 200;

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
 * Zod schema for the raw list query string. Every field is optional; a present
 * but malformed value fails the parse (→ 400). `limit`/`offset` arrive as
 * strings and are coerced to non-negative integers here — `limit` is then
 * CLAMPED to {@link MAX_CATALOG_LIMIT} rather than rejected, so an over-eager
 * client gets a capped page instead of an error.
 */
const listQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
    bodyPart: z.enum(EXERCISE_BODY_PARTS).optional(),
    equipment: z.string().trim().min(1).optional(),
    target: z.string().trim().min(1).optional(),
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
  const { search, bodyPart, equipment, target, limit, offset } = parsed.data;

  const appliedLimit = Math.min(limit ?? DEFAULT_CATALOG_LIMIT, MAX_CATALOG_LIMIT);
  const appliedOffset = offset ?? 0;

  const filters: ExerciseCatalogFilters = {
    limit: appliedLimit,
    offset: appliedOffset,
  };
  if (search) filters.search = search;
  if (bodyPart) filters.bodyPart = bodyPart;
  if (equipment) filters.equipment = equipment;
  if (target) filters.target = target;

  return { ok: true, query: { filters, limit: appliedLimit, offset: appliedOffset } };
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

/** Tally one record field across the whole catalog, sorted by value ascending. */
function tally(
  records: readonly ExerciseCatalogRecord[],
  pick: (record: ExerciseCatalogRecord) => string,
): ExerciseCatalogFacetValue[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = pick(record);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/**
 * Memoized facets. The catalog is frozen at build time, so the full scan is
 * done at most ONCE per process and every later request is a map lookup.
 * Lazy (not module-init) so importing the route never pays for it.
 */
let cachedFacets: ExerciseCatalogFacets | undefined;

export function computeExerciseCatalogFacets(): ExerciseCatalogFacets {
  if (cachedFacets) {
    return cachedFacets;
  }
  // `limit` omitted → every record, which is exactly what a facet scan needs.
  const all = listExercises().items;
  cachedFacets = {
    bodyPart: tally(all, (record) => record.bodyPart),
    equipment: tally(all, (record) => record.equipment),
    target: tally(all, (record) => record.target),
  };
  return cachedFacets;
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
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send(computeExerciseCatalogFacets());
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
