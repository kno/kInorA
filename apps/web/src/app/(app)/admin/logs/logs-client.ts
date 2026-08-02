import "server-only";

/**
 * Pure API client for the admin observability logs endpoint (GH #310, Slice 2).
 *
 * Extracted from the server/client components so the fetch + result-mapping and
 * querystring-building logic is unit-testable without Next.js framework
 * imports. Mirrors `tenant-provisioning-client.ts`.
 *
 * server-only: reads `process.env.API_BASE_URL` (the internal Docker address)
 * and must never be imported by client components. Client-safe types live in
 * `logs-constants.ts`.
 */

import {
  type LogEvent,
  type LogFilters,
  type LogsResult,
} from "./logs-constants";

export type { LogEvent, LogFilters, LogsResult };

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

type ClientOptions = { apiBaseUrl?: string; fetchImpl?: typeof fetch };

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Build the `GET /admin/logs` querystring from the filter object. Blank string
 * params are omitted; the remaining values are URL-encoded via URLSearchParams
 * (spaces → `+`, reserved chars percent-encoded) in a stable field order.
 */
function buildQuery(filters: LogFilters): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string | undefined) => {
    if (value !== undefined && value.trim().length > 0) params.set(key, value);
  };

  put("tenantId", filters.tenantId);
  put("level", filters.level);
  put("event", filters.event);
  put("from", filters.from);
  put("to", filters.to);
  if (typeof filters.limit === "number" && Number.isFinite(filters.limit)) {
    params.set("limit", String(filters.limit));
  }
  put("cursor", filters.cursor);

  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/** Read audit logs via GET /admin/logs (requireAuth + requireAdmin). */
export async function fetchLogs(
  token: string | undefined,
  filters: LogFilters,
  options: ClientOptions = {},
): Promise<LogsResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const url = `${base}/admin/logs${buildQuery(filters)}`;
    const res = await fetchImpl(url, {
      headers: authHeaders(token),
      cache: "no-store",
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 422) return { kind: "invalid" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const body = (await res.json()) as { events?: LogEvent[]; nextCursor?: string };
    return { kind: "ok", events: body.events ?? [], nextCursor: body.nextCursor };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}
