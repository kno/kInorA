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
 * Save an edited program, and — when the editor carries one — the plan's name
 * (#415).
 *
 * A full-document replace carrying the `version` the editor loaded (#421 — an
 * integer token, not the `updatedAt` timestamp this used to send). The server
 * is the source of truth for validation; the editor's own pre-flight check only
 * spares the user a round-trip.
 *
 * `name` is sent as an explicit field rather than folded into the program,
 * because it is a column and not part of the program document. `undefined`
 * omits it from the envelope entirely, which the server reads as "leave the
 * stored name alone" — distinct from sending a blank one, which it refuses.
 */
export async function updatePlanProgram(
  planId: string,
  program: WorkoutProgram,
  expectedVersion: number,
  name: string | undefined,
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
      body: JSON.stringify(
        name === undefined
          ? { program, expectedVersion }
          : { program, expectedVersion, name },
      ),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      issues?: string[];
      currentVersion?: number | null;
    };

    if (res.status === 409 && payload.error === "edit_conflict") {
      return { kind: "conflict", currentVersion: payload.currentVersion ?? null };
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
    name?: string;
    program?: WorkoutProgram;
    version?: number;
  } | null;
  // `typeof`, not truthiness: a version is a number, and treating a numeric 0
  // as "missing" is the kind of coincidence that turns into a bug the day the
  // server's numbering changes.
  // `!body.name` rather than a `typeof` check, unlike `version` above: the
  // server resolves every name through the blank→default layer, so it never
  // returns an empty string. Falsy here genuinely means malformed.
  if (!body?.program || typeof body.version !== "number" || !body.name) {
    return { kind: "error", message: "invalid_response" };
  }

  return {
    kind: "ok",
    name: body.name,
    program: body.program,
    version: body.version,
  };
}
