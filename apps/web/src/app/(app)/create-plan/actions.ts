"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PlanSpec } from "@kinora/contracts";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { promotePlanSpec, submitDraft } from "./plan-draft-client";

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
  const result = await submitDraft(step, spec, token);
  if (result.kind === "error") {
    throw new Error(result.message);
  }
}

/** Promote the draft to a confirmed PlanSpec, then redirect to the plan view. */
export async function confirmPlanSpecAction(): Promise<void> {
  const token = await sessionToken();
  const result = await promotePlanSpec(token);
  if (result.kind === "error") {
    throw new Error(result.message);
  }
  redirect("/plan");
}
