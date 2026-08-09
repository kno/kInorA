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
 * `GET /workout-plans?progress=1&includeArchived=1` (17d PR A progress + PR B
 * archive). Mirrors `fetchWorkoutHistory` / `fetchUserPlans` — a plain read
 * through the existing session-cookie-authenticated API path. Distinct from
 * `fetchUserPlans` (which the `/plan` selector still uses, unchanged, and
 * which never sees archived plans) because it opts into both the progress
 * fields AND the archived rows — `PlanList` splits them client-side into the
 * default grid and the show-archived section, so one fetch serves both.
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
    res = await fetchImpl(`${base}/workout-plans?progress=1&includeArchived=1`, {
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

export type ArchivePlanResult =
  | { kind: "ok"; id: string; archivedAt: string | null }
  | { kind: "error"; message: string };

/** Shared implementation for archive/unarchive — same request shape, different path segment. */
async function setArchived(
  action: "archive" | "unarchive",
  planId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<ArchivePlanResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/workout-plans/${planId}/${action}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? `${action}_failed` };
  }

  const body = (await res.json().catch(() => null)) as { id: string; archivedAt: string | null } | null;
  if (!body?.id) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", id: body.id, archivedAt: body.archivedAt };
}

/** `POST /workout-plans/:id/archive` (17d PR B). */
export function archivePlan(
  planId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<ArchivePlanResult> {
  return setArchived("archive", planId, token, options);
}

/** `POST /workout-plans/:id/unarchive` (17d PR B). */
export function unarchivePlan(
  planId: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<ArchivePlanResult> {
  return setArchived("unarchive", planId, token, options);
}
