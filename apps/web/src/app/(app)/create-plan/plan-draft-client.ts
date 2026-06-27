/**
 * Pure orchestration for the create-plan draft + promote API calls.
 *
 * Extracted from the Next.js Server Actions so the API-call + result-mapping
 * logic is unit-testable with a mock `fetch` (no Next framework imports). The
 * Server Actions in `actions.ts` wrap these: they read the `kinora_session`
 * cookie for the Bearer token and pass it in, then redirect on promote.
 *
 * Mirrors the `submitLogin` pattern (login/submit-login.ts).
 *
 * The client sends the raw wizard input to the API. preferenceScores and
 * confirmed are derived server-side on promote — the client never computes them.
 */
import type { PlanSpec } from "@kinora/contracts";

/** True when every required PlanSpec field is present (equipment/limitations may be empty). */
export function isSpecComplete(spec: Partial<PlanSpec>): boolean {
  return (
    spec.goal != null &&
    spec.location != null &&
    spec.daysPerWeek != null &&
    spec.sessionDurationMinutes != null &&
    spec.equipment != null &&
    spec.limitations != null
  );
}

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

export interface CurrentDraft {
  step: number;
  spec: Partial<PlanSpec>;
}

export type DraftSubmitResult =
  | { kind: "ok" }
  | { kind: "error"; message: string };

export type PromoteResult =
  | { kind: "ok"; id: string }
  | { kind: "error"; message: string };

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

/**
 * Load the current server draft via `GET /plan-specs/drafts/current`.
 * Returns `null` when there is no session, no draft (`204`), or on any error
 * — the wizard then starts fresh at step 1.
 */
export async function loadCurrentDraft(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<CurrentDraft | null> {
  if (!token) return null;

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs/drafts/current`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (res.status === 204 || !res.ok) {
    return null;
  }

  const body = (await res.json().catch(() => null)) as CurrentDraft | null;
  if (!body || typeof body.step !== "number") {
    return null;
  }
  return { step: body.step, spec: body.spec ?? {} };
}

/**
 * Upsert the current draft via `POST /plan-specs/drafts`.
 * The token is the opaque session bearer read from the `kinora_session` cookie.
 */
export async function submitDraft(
  step: number,
  spec: Partial<PlanSpec>,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<DraftSubmitResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs/drafts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ step, spec }),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "draft_save_failed" };
  }

  return { kind: "ok" };
}

/**
 * Promote the current draft to a confirmed `PlanSpec` via `POST /plan-specs`.
 * Returns the new spec id on success; a `409` maps to an error result so the
 * UI can keep the user on the wizard.
 */
export async function promotePlanSpec(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<PromoteResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "promote_failed" };
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return { kind: "error", message: "no_spec_id" };
  }

  return { kind: "ok", id: body.id };
}
