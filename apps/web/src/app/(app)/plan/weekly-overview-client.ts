import "server-only";

import type { WeeklyOverviewDTO } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type FetchWeeklyOverviewResult =
  | { kind: "ok"; overview: WeeklyOverviewDTO }
  | { kind: "error"; message: string };

/**
 * Fetch the weekly plan-board overview via `GET /progress/weekly-overview`
 * (09c-v1-progress-dashboard-stats, Slice 4b). Mirrors
 * `fetchDashboardSummary` — a plain read through the existing session-
 * cookie-authenticated API path. `weekStart` is passed through verbatim
 * (an ISO `YYYY-MM-DD` date, or `undefined` for the current week).
 */
export async function fetchWeeklyOverview(
  token: string | undefined,
  weekStart: string | undefined,
  options: ClientOptions = {}
): Promise<FetchWeeklyOverviewResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = weekStart
    ? `${base}/progress/weekly-overview?weekStart=${encodeURIComponent(weekStart)}`
    : `${base}/progress/weekly-overview`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_weekly_overview_failed" };
  }

  const body = (await res.json().catch(() => null)) as WeeklyOverviewDTO | null;
  if (!body || typeof body.weekStart !== "string" || !Array.isArray(body.days)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", overview: body };
}
