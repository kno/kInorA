/**
 * Pure planner for the `GET /admin/tenants` search endpoint. Kept free of any
 * `db/*` import (dep-cruiser `routes-no-db-layer`) and free of Fastify so the
 * name-substring / exact-UUID / limit-cap decision is unit-testable in
 * isolation. The concrete Drizzle `AdminTenantsRepository.searchTenants`
 * consumes the resulting plan.
 */

/**
 * Plain 8-4-4-4-12 hex UUID shape — mirrors `admin-tier-override.ts`'s
 * `UUID_SHAPE` so test fixtures using non-RFC-4122 UUID literals (which
 * Postgres still accepts as valid `uuid` values) are recognised.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_QUERY_LENGTH = 100;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export type TenantSearchPlan =
  | { ok: false }
  | { ok: true; term: string; matchId: string | null; limit: number };

/**
 * Escape the LIKE/ILIKE special characters (`\`, `%`, `_`) in a user-supplied
 * term so a query like `50%` is matched literally rather than as a wildcard.
 * The default `\` escape character is assumed (Drizzle's `ilike` emits no
 * custom `ESCAPE` clause).
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Build the search plan from the raw `query`/`limit` request inputs.
 *
 * - Empty/whitespace-only or over-long (`> 100`) query → `{ ok: false }`
 *   (the route maps this to 422).
 * - `matchId` is set only when the trimmed query is a valid UUID shape, so the
 *   repo can `OR` an exact-id match onto the name ILIKE.
 * - `limit` defaults to 20, is floored at 1 (invalid → default), and is capped
 *   at 50.
 */
export function planTenantSearch(rawQuery: unknown, rawLimit: unknown): TenantSearchPlan {
  if (typeof rawQuery !== "string") {
    return { ok: false };
  }

  const trimmed = rawQuery.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_QUERY_LENGTH) {
    return { ok: false };
  }

  const matchId = UUID_SHAPE.test(trimmed) ? trimmed : null;

  let limit = DEFAULT_LIMIT;
  const parsed =
    typeof rawLimit === "number"
      ? rawLimit
      : typeof rawLimit === "string"
        ? Number.parseInt(rawLimit, 10)
        : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 1) {
    limit = Math.min(Math.floor(parsed), MAX_LIMIT);
  }

  return { ok: true, term: escapeLike(trimmed), matchId, limit };
}
