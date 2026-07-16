import "server-only";

import type { WorkoutHistoryEntry, WorkoutHistoryQuery } from "@kinora/contracts";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type FetchHistoryResult =
  | { kind: "ok"; entries: WorkoutHistoryEntry[] }
  | { kind: "error"; message: string };

function historyPath(query: WorkoutHistoryQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));

  const search = params.toString();
  return search ? `/workout-sessions/history?${search}` : "/workout-sessions/history";
}

/**
 * Fetch a page of completed-session history via `GET /workout-sessions/history`.
 *
 * History is sync-independent (spec: "History available without pending sync
 * activity") — this module never reads or writes the offline mutation queue
 * or session snapshot cache; it is a plain read through the existing
 * session-cookie-authenticated API path, mirroring `fetchUserPlans` /
 * `fetchWorkoutSession` in the neighboring `plan` route group.
 */
export async function fetchWorkoutHistory(
  token: string | undefined,
  query: WorkoutHistoryQuery,
  options: ClientOptions = {},
): Promise<FetchHistoryResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}${historyPath(query)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "fetch_history_failed" };
  }

  const body = (await res.json().catch(() => null)) as WorkoutHistoryEntry[] | null;
  if (!Array.isArray(body)) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", entries: body };
}
