import "server-only";

import type { WorkoutProgram } from "@kinora/contracts";
import type { UpdateProgramResult } from "./program-edit-types";
import { apiBaseUrl } from "@/app/(app)/create-plan/plan-draft-client";

interface ClientOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export type { UpdateProgramResult } from "./program-edit-types";

/**
 * Save an edited program.
 *
 * A full-document replace carrying the `updatedAt` the editor loaded. The
 * server is the source of truth for validation; the editor's own pre-flight
 * check only spares the user a round-trip.
 */
export async function updatePlanProgram(
  planId: string,
  program: WorkoutProgram,
  expectedUpdatedAt: string,
  token: string | undefined,
  options: ClientOptions = {},
): Promise<UpdateProgramResult> {
  if (!token) {
    return { kind: "error", message: "no_session" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/workout-plans/${planId}/program`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ program, expectedUpdatedAt }),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      issues?: string[];
      currentUpdatedAt?: string | null;
    };

    if (res.status === 409 && payload.error === "edit_conflict") {
      return { kind: "conflict", currentUpdatedAt: payload.currentUpdatedAt ?? null };
    }
    if (res.status === 409) {
      return { kind: "not_ready" };
    }
    if (res.status === 422) {
      return {
        kind: "invalid",
        issues: payload.issues ?? (payload.error ? [payload.error] : []),
      };
    }
    return { kind: "error", message: payload.error ?? "update_program_failed" };
  }

  const body = (await res.json().catch(() => null)) as {
    program?: WorkoutProgram;
    updatedAt?: string;
  } | null;
  if (!body?.program || !body.updatedAt) {
    return { kind: "error", message: "invalid_response" };
  }

  return { kind: "ok", program: body.program, updatedAt: body.updatedAt };
}
