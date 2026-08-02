import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { buildRequireAdmin } from "../auth/require-admin.js";
import type { ObservabilityLevel } from "../observability/event-logger.js";

/**
 * Superadmin observability log query API (#310, Slice 1).
 *
 *   GET /admin/logs?tenantId=&level=&event=&from=&to=&limit=&cursor=
 *   → 200 { events, nextCursor } | 403 non-admin | 422 bad input
 *
 * requireAuth() + requireAdmin gate it exactly like `admin-tenants.ts`. The
 * route imports ZERO `db/*` (dep-cruiser `routes-no-db-layer`): it depends only
 * on the `AdminLogsRouteRepo` port, satisfied by the `ObservabilityEventsRepository`
 * composed in app.ts.
 */

/** Plain 8-4-4-4-12 hex UUID shape — same rationale as `admin-tenants.ts`. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OBSERVABILITY_LEVELS = ["info", "warn", "error"] as const;

/** Max query `limit` — hard cap so a single read can never scan unbounded rows. */
export const MAX_LOG_QUERY_LIMIT = 100;
const DEFAULT_LOG_QUERY_LIMIT = 50;
const MAX_EVENT_FILTER_LENGTH = 200;

/** A read-side row projected for the /admin/logs response. */
export interface ObservabilityEventView {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  level: ObservabilityLevel;
  event: string;
  outcome: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: Date;
}

/** Validated, repository-ready query filters. */
export interface ObservabilityLogQuery {
  tenantId?: string;
  level?: ObservabilityLevel;
  event?: string;
  from?: Date;
  to?: Date;
  /** Capped 1..{@link MAX_LOG_QUERY_LIMIT}; defaults to 50. */
  limit: number;
  /** Opaque keyset cursor from a prior page's `nextCursor`. */
  cursor?: string;
}

/** Paginated result: newest-first page + an optional opaque next-page cursor. */
export interface ObservabilityLogPage {
  events: ObservabilityEventView[];
  nextCursor: string | null;
}

/**
 * Narrow route port. `findUserById` feeds `buildRequireAdmin`; `queryEvents`
 * is satisfied by the concrete `ObservabilityEventsRepository` in app.ts.
 */
export interface AdminLogsRouteRepo {
  findUserById(id: string): Promise<{ id: string; isAdmin: boolean } | null>;
  queryEvents(filters: ObservabilityLogQuery): Promise<ObservabilityLogPage>;
}

export interface AdminLogsRoutesOptions {
  repo: AdminLogsRouteRepo;
}

/**
 * Zod schema for the raw query string. Every field is optional; a present but
 * malformed value fails the parse (→ 422). `limit` arrives as a string and is
 * coerced+bounded; `from`/`to` are ISO-8601 datetimes.
 */
const rawQuerySchema = z
  .object({
    tenantId: z.string().regex(UUID_SHAPE).optional(),
    level: z.enum(OBSERVABILITY_LEVELS).optional(),
    event: z
      .string()
      .trim()
      .min(1)
      .max(MAX_EVENT_FILTER_LENGTH)
      .optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number(value))
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= MAX_LOG_QUERY_LIMIT)
      .optional(),
    cursor: z.string().min(1).optional(),
  })
  .strip();

export type PlanObservabilityLogQueryResult =
  | { ok: true; filters: ObservabilityLogQuery }
  | { ok: false };

/**
 * Pure query-string validator/planner. Returns `{ ok: false }` for ANY invalid
 * input (bad level, malformed tenantId, unparseable/inverted date range,
 * out-of-range limit, blank/oversized event) so the route can map it to 422
 * WITHOUT ever reaching the repository. Kept pure so it is unit-testable
 * without a Fastify request.
 */
export function planObservabilityLogQuery(raw: unknown): PlanObservabilityLogQueryResult {
  const parsed = rawQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false };
  }
  const { tenantId, level, event, from, to, limit, cursor } = parsed.data;

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  if (fromDate && Number.isNaN(fromDate.getTime())) return { ok: false };
  if (toDate && Number.isNaN(toDate.getTime())) return { ok: false };
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) return { ok: false };

  const filters: ObservabilityLogQuery = {
    limit: limit ?? DEFAULT_LOG_QUERY_LIMIT,
  };
  if (tenantId) filters.tenantId = tenantId;
  if (level) filters.level = level;
  if (event) filters.event = event;
  if (fromDate) filters.from = fromDate;
  if (toDate) filters.to = toDate;
  if (cursor) filters.cursor = cursor;

  return { ok: true, filters };
}

/** Serialize a stored row to the JSON response shape (Date → ISO string). */
function toResponseEvent(view: ObservabilityEventView): Omit<ObservabilityEventView, "createdAt"> & {
  createdAt: string;
} {
  return {
    id: view.id,
    tenantId: view.tenantId,
    actorUserId: view.actorUserId,
    level: view.level,
    event: view.event,
    outcome: view.outcome,
    metadata: view.metadata,
    createdAt: view.createdAt.toISOString(),
  };
}

export const adminLogsRoutes: FastifyPluginAsync<AdminLogsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { repo } = options;
  if (!repo) {
    throw new Error("adminLogsRoutes requires a repo");
  }
  const requireAdmin = buildRequireAdmin({ findById: repo.findUserById });

  fastify.get(
    "/admin/logs",
    { preHandler: [requireAuth(), requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const plan = planObservabilityLogQuery(request.query ?? {});
      if (!plan.ok) {
        return reply.code(422).send({ error: "Validation Error" });
      }

      const page = await repo.queryEvents(plan.filters);

      return reply.code(200).send({
        events: page.events.map(toResponseEvent),
        nextCursor: page.nextCursor,
      });
    },
  );
};
