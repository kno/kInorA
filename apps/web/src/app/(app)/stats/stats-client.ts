import "server-only";

import type { StatsSummaryDTO } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";

export type StatsRange = "week" | "month" | "year";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type FetchStatsSummaryResult =
  | { kind: "ok"; summary: StatsSummaryDTO }
  | { kind: "error"; message: string };

/**
 * Fetch the statistics summary via `GET /progress/stats?range=` (Slice 3a).
 * Mirrors `fetchDashboardSummary` — a plain read through the existing
 * session-cookie-authenticated API path.
 */
export async function fetchStatsSummary(
  token: string | undefined,
  range: StatsRange,
  options: ClientOptions = {},
): Promise<FetchStatsSummaryResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/progress/stats?range=${range}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_stats_failed" };
  }

  const body = (await res.json().catch(() => null)) as StatsSummaryDTO | null;
  if (!body || typeof body.totalVolumeKg?.value !== "number") {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", summary: body };
}
