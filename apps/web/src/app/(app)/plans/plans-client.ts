import "server-only";

import type { WorkoutPlanSummary } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type FetchPlansWithProgressResult =
  | { kind: "ok"; plans: WorkoutPlanSummary[] }
  | { kind: "error"; message: string };

/**
 * Fetch every plan with its progress projection via
 * `GET /workout-plans?progress=1` (17d PR A). Mirrors `fetchWorkoutHistory` /
 * `fetchUserPlans` — a plain read through the existing session-cookie-
 * authenticated API path. Distinct from `fetchUserPlans` (which the `/plan`
 * selector still uses, unchanged) because it opts into the three extra
 * progress fields the `/plans` list needs.
 */
export async function fetchUserPlansWithProgress(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<FetchPlansWithProgressResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/workout-plans?progress=1`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_plans_failed" };
  }

  const body = (await res.json().catch(() => null)) as WorkoutPlanSummary[] | null;
  if (!Array.isArray(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", plans: body };
}
