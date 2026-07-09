/**
 * Plan status page — /plan/[id]
 *
 * Server component that:
 *  1. Fetches the initial plan status from GET /workout-plans/:id, using the
 *     session token read server-side from the httpOnly kinora_session cookie.
 *  2. Renders PlanStatusClient (client component) with initial state. i18n is
 *     resolved by next-intl's request config — no message threading needed
 *     since this page renders no localized text of its own.
 *
 * Issue #42: the session token is used ONLY for the server-side fetch here. It
 * is NOT passed to PlanStatusClient — the browser authenticates the WS upgrade
 * via the same-origin cookie, keeping the token out of the RSC payload/WS URL.
 *
 * The client component subscribes to the WS for live updates and handles
 * the "Regenerate" CTA.
 */
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchPlanStatus } from "@/app/(app)/create-plan/plan-draft-client";
import { PlanStatusClient } from "./PlanStatusClient";
import type { WorkoutProgram } from "@kinora/contracts";

interface PlanPageProps {
  params: Promise<{ id: string }>;
}

export default async function PlanStatusPage({ params }: PlanPageProps) {
  const { id: planId } = await params;

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // Fetch the initial plan status server-side for fast first render.
  // On 404 or cross-tenant, Next.js returns a 404 page.
  const result = await fetchPlanStatus(planId, token);

  if (result.kind === "error" && result.message === "not_found") {
    notFound();
  }

  const plan =
    result.kind === "ok"
      ? result.plan
      : { id: planId, status: "generating" };

  return (
    <PlanStatusClient
      planId={planId}
      specId={plan.specId}
      planName={"name" in plan ? plan.name : undefined}
      initialStatus={plan.status}
      initialProgram={
        plan.status === "ready" ? (plan.program as WorkoutProgram) : undefined
      }
    />
  );
}
