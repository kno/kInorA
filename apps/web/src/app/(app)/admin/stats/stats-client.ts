import "server-only";

/**
 * Pure API client for the admin platform-statistics endpoint (GH #309).
 *
 * Extracted so the fetch + result-mapping logic is unit-testable without
 * Next.js framework imports. Mirrors `logs-client.ts`.
 *
 * server-only: reads `process.env.API_BASE_URL` (the internal Docker address)
 * and must never be imported by client components. Client-safe types live in
 * `stats-constants.ts`.
 */

import { type PlatformStats, type StatsResult } from "./stats-constants";

export type { PlatformStats, StatsResult };

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

type ClientOptions = { apiBaseUrl?: string; fetchImpl?: typeof fetch };

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Read platform stats via GET /admin/stats (requireAuth + requireAdmin). */
export async function fetchStats(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<StatsResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${base}/admin/stats`, {
      headers: authHeaders(token),
      cache: "no-store",
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const stats = (await res.json()) as PlatformStats;
    return { kind: "ok", stats };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}
