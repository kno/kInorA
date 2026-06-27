"use server";

import { cookies } from "next/headers";
import type { PlanSpec } from "@kinora/contracts";
import { derivePreferenceScores } from "@kinora/domain/plan";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { enrichDraftSpec, promotePlanSpec, submitDraft } from "./plan-draft-client";

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

/** Persist the current step + spec. Throws on failure so the client surfaces it. */
export async function saveDraftAction(
  step: number,
  spec: Partial<PlanSpec>,
): Promise<void> {
  const token = await sessionToken();
  const enriched = enrichDraftSpec(spec, derivePreferenceScores);
  const result = await submitDraft(step, enriched, token);
  if (result.kind === "error") {
    throw new Error(result.message);
  }
}

/**
 * Promote the draft to a confirmed PlanSpec. Throws on failure so the client
 * surfaces it; on success the client navigates to the plan view. Navigation is
 * client-side (router.push) rather than a server `redirect()` so the call works
 * from a plain onClick handler, not only inside a `<form action>`.
 */
export async function confirmPlanSpecAction(): Promise<void> {
  const token = await sessionToken();
  const result = await promotePlanSpec(token);
  if (result.kind === "error") {
    throw new Error(result.message);
  }
}
