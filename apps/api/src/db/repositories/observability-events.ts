import { and, desc, eq, gte, lte, lt, or, type SQL } from "drizzle-orm";
import type { Database } from "../client.js";
import { observabilityEvents } from "../schema.js";
import type {
  ObservabilityEventRecord,
  ObservabilityEventRecorderPort,
} from "../../observability/event-logger.js";
import type {
  AdminLogsRouteRepo,
  ObservabilityEventView,
  ObservabilityLogPage,
  ObservabilityLogQuery,
} from "../../routes/admin-logs.js";

/** Hard bound the repository will never exceed even if handed a larger limit. */
const HARD_MAX_LIMIT = 100;

/**
 * Drizzle adapter for observability events (#310, Slice 1). Lives under `db/`
 * because `.dependency-cruiser.cjs` forbids importing drizzle/pg outside the
 * infra layer; the `event-logger` port and the `admin-logs` route depend only
 * on the interfaces this class implements.
 *
 * Implements BOTH sides of the hybrid:
 *   - {@link ObservabilityEventRecorderPort.record} — the INSERT the
 *     `DefaultObservabilityLogger` fans out to (fire-and-forget on the caller's
 *     side; this method may reject and the logger swallows it).
 *   - {@link AdminLogsRouteRepo.queryEvents} — the paginated, filterable
 *     read backing GET /admin/logs.
 *
 * Reads project ONLY the persisted columns (ids, level, event, outcome, scalar
 * metadata) — the same PII-free surface the writers are constrained to.
 */
export class ObservabilityEventsRepository
  implements ObservabilityEventRecorderPort, Pick<AdminLogsRouteRepo, "queryEvents">
{
  constructor(private readonly db: Database) {}

  /**
   * Insert one curated event. `createdAt`/`id` are DB-defaulted. Never called
   * on the critical path directly — the logger dispatches it fire-and-forget —
   * so a rejection here is caught and downgraded by the logger, never surfaced
   * to a domain flow.
   */
  async record(event: ObservabilityEventRecord): Promise<void> {
    await this.db.insert(observabilityEvents).values({
      tenantId: event.tenantId,
      actorUserId: event.actorUserId,
      level: event.level,
      event: event.event,
      outcome: event.outcome,
      metadata: event.metadata,
    });
  }

  /**
   * Paginated newest-first read with optional tenant/level/event/time-window
   * filters. Pagination uses a keyset cursor over `(createdAt, id)` — a stable
   * ordering that never skips or repeats rows across pages even as new events
   * arrive. Fetches `limit + 1` rows to detect whether another page exists.
   */
  async queryEvents(filters: ObservabilityLogQuery): Promise<ObservabilityLogPage> {
    const limit = Math.min(Math.max(filters.limit, 1), HARD_MAX_LIMIT);

    const conditions: SQL[] = [];
    if (filters.tenantId) conditions.push(eq(observabilityEvents.tenantId, filters.tenantId));
    if (filters.level) conditions.push(eq(observabilityEvents.level, filters.level));
    if (filters.event) conditions.push(eq(observabilityEvents.event, filters.event));
    if (filters.from) conditions.push(gte(observabilityEvents.createdAt, filters.from));
    if (filters.to) conditions.push(lte(observabilityEvents.createdAt, filters.to));

    const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
    if (cursor) {
      // Strictly older than the last row of the previous page, in the same
      // (createdAt desc, id desc) ordering: createdAt < c OR (createdAt = c AND id < cId).
      const keyset = or(
        lt(observabilityEvents.createdAt, cursor.createdAt),
        and(
          eq(observabilityEvents.createdAt, cursor.createdAt),
          lt(observabilityEvents.id, cursor.id),
        ),
      );
      if (keyset) conditions.push(keyset);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        id: observabilityEvents.id,
        tenantId: observabilityEvents.tenantId,
        actorUserId: observabilityEvents.actorUserId,
        level: observabilityEvents.level,
        event: observabilityEvents.event,
        outcome: observabilityEvents.outcome,
        metadata: observabilityEvents.metadata,
        createdAt: observabilityEvents.createdAt,
      })
      .from(observabilityEvents)
      .where(where)
      .orderBy(desc(observabilityEvents.createdAt), desc(observabilityEvents.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const events: ObservabilityEventView[] = page.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      actorUserId: row.actorUserId,
      level: row.level,
      event: row.event,
      outcome: row.outcome,
      metadata: row.metadata ?? {},
      createdAt: row.createdAt,
    }));

    const last = events[events.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return { events, nextCursor };
  }
}

/** Opaque, URL-safe keyset cursor: base64url of `${isoCreatedAt}|${id}`. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

/** Decode a cursor; returns null for anything malformed (so a bad cursor is ignored, not fatal). */
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep <= 0) return null;
    const iso = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
