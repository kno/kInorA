/**
 * Client-safe admin-logs constants and result types (GH #310, Slice 2).
 *
 * Intentionally free of `server-only`: imported by both the server-only
 * `logs-client.ts` and the client component `LogsView.tsx`. Keeping the pure
 * types/enums here prevents the build from failing when the client component
 * imports them (mirrors `tenant-provisioning-constants.ts`).
 */

/** The log severity levels (mirrors the API `z.enum(["info","warn","error"])`). */
export const LOG_LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** One audit-log event row, mirroring the API `GET /admin/logs` response shape. */
export interface LogEvent {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  level: LogLevel;
  event: string;
  outcome: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * Read filters forwarded to `GET /admin/logs` as query params. Every field is
 * optional; empty/blank strings are omitted from the querystring by the client.
 */
export interface LogFilters {
  tenantId?: string;
  level?: LogLevel | "";
  event?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Discriminated result envelope shared by the server-only `fetchLogs` call and
 * the client view — mirrors `tenant-provisioning-constants.ts`'s `kind` union
 * so the view maps each API status to a single human message.
 */
export type LogsResult =
  | { kind: "ok"; events: LogEvent[]; nextCursor?: string }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "error"; message: string };
