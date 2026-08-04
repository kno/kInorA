import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchClientPlan } from "../../../trainer-client";
import { ClientPlanView } from "./ClientPlanView";

/**
 * Trainer-facing plan detail page — `/clients/[clientUserId]/plan/[planId]`
 * (#341).
 *
 * This is where `CreatePlanForClientForm` now redirects after creating a plan
 * for a client. `/plan/[planId]` cannot serve that flow: the plan is owned by
 * the CLIENT, and `GET /workout-plans/:id` is hard-scoped to the caller's own
 * `(tenantId, userId)`, so the trainer 404s on the plan it just created.
 *
 * Authorization is entirely server-side, in
 * `GET /clients/:clientUserId/workout-plans/:planId` — an unassigned or
 * unentitled caller gets a 403 before any read, surfaced here as the
 * access-restricted state. This page performs no authorization check of its
 * own and must not be treated as one.
 */
export default async function ClientPlanPage({
  params,
}: {
  params: Promise<{ clientUserId: string; planId: string }>;
}) {
  const { clientUserId, planId } = await params;

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await fetchClientPlan(clientUserId, planId, token);

  return <ClientPlanView clientUserId={clientUserId} result={result} />;
}
