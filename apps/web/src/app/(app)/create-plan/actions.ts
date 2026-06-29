"use server";

import { cookies } from "next/headers";
import type { PlanSpec } from "@kinora/contracts";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { promotePlanSpec, confirmPlanGen, submitDraft, regeneratePlan } from "./plan-draft-client";

/**
 * Server Actions for the create-plan wizard.
 *
 * Thin framework glue (excluded from coverage; the branching logic lives in
 * the unit-tested `plan-draft-client.ts`). Each action reads the opaque
 * session token from the `kinora_session` httpOnly cookie and forwards it as
 * a Bearer token — mirroring `login/actions.ts` + `submit-login.ts`.
 */

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

/**
 * Persist the current step + partial spec. Sends the raw wizard input to the
 * API without enrichment — the server derives preferenceScores on promote.
 * Throws on failure so the client surfaces it.
 */
export async function saveDraftAction(
  step: number,
  spec: Partial<PlanSpec>,
): Promise<void> {
  const token = await sessionToken();
  const result = await submitDraft(step, spec, token);
  if (result.kind === "error") {
    throw new Error(result.message);
  }
}

/**
 * Promote the draft to a confirmed PlanSpec, then trigger AI plan generation.
 *
 * 1. POST /plan-specs → create confirmed spec → { id: specId }
 * 2. POST /plan-specs/:specId/confirm → trigger generation → { planId, status }
 *
 * Returns the planId so the client can navigate to /plan/[planId].
 * Throws on failure so the client surfaces it.
 */
export async function confirmPlanSpecAction(): Promise<{ planId: string; status: string }> {
  const token = await sessionToken();
  const promoteResult = await promotePlanSpec(token);
  if (promoteResult.kind === "error") {
    throw new Error(promoteResult.message);
  }
  const confirmResult = await confirmPlanGen(promoteResult.id, token);
  if (confirmResult.kind === "error") {
    throw new Error(confirmResult.message);
  }
  return { planId: confirmResult.planId, status: confirmResult.status };
}

/**
 * Trigger plan regeneration for an already-confirmed spec.
 * Returns { planId, status: "generating" } so the client can update UI.
 * Throws on failure so the client surfaces it.
 */
export async function regeneratePlanAction(specId: string): Promise<{ planId: string; status: string }> {
  const token = await sessionToken();
  const result = await regeneratePlan(specId, token);
  if (result.kind === "error") {
    throw new Error(result.message);
  }
  return { planId: result.planId, status: result.status };
}
