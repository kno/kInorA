import "server-only";

import type { ExerciseDetailDTO } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type FetchExerciseDetailResult =
  | { kind: "ok"; detail: ExerciseDetailDTO }
  | { kind: "error"; message: string };

/**
 * Fetch the read-only exercise-history reference via
 * `GET /progress/exercise-detail?title=` (09c-v1-progress-dashboard-stats,
 * Slice 4b). Mirrors `fetchDashboardSummary` — a plain read through the
 * existing session-cookie-authenticated API path.
 */
export async function fetchExerciseDetail(
  token: string | undefined,
  title: string,
  options: ClientOptions = {}
): Promise<FetchExerciseDetailResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/progress/exercise-detail?title=${encodeURIComponent(title)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_exercise_detail_failed" };
  }

  const body = (await res.json().catch(() => null)) as ExerciseDetailDTO | null;
  if (!body || typeof body.exerciseTitle !== "string" || !Array.isArray(body.recentSets)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", detail: body };
}
