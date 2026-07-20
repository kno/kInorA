import "server-only";

import type { DashboardSummaryDTO } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type FetchDashboardSummaryResult =
  | { kind: "ok"; summary: DashboardSummaryDTO }
  | { kind: "error"; message: string };

/**
 * Fetch the dashboard progress summary via `GET /progress/dashboard`
 * (09c-v1-progress-dashboard-stats, Slice 2). Mirrors `fetchWorkoutHistory`
 * — a plain read through the existing session-cookie-authenticated API
 * path, no offline queue/snapshot involvement.
 */
export async function fetchDashboardSummary(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<FetchDashboardSummaryResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/progress/dashboard`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_dashboard_failed" };
  }

  const body = (await res.json().catch(() => null)) as DashboardSummaryDTO | null;
  if (!body || typeof body.streak !== "number") {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", summary: body };
}
