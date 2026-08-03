"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionCookieOptions } from "@/auth/session-cookie";
import { fetchDashboardSummary, type FetchDashboardSummaryResult } from "./dashboard-client";
import { adaptPlan } from "@/app/(app)/create-plan/plan-draft-client";

/** Result of confirming an adherence adaptation from the coach banner. */
export type AdaptPlanActionResult = { kind: "ok" } | { kind: "error"; message: string };

/**
 * Logout Server Action.
 *
 * Calls the API to invalidate the DB session, then clears the
 * httpOnly session cookie and redirects to the login page.
 * The API call is best-effort — if it fails, the cookie is still
 * cleared so the local session is destroyed regardless.
 */
export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // Best-effort API call to invalidate the DB session.
  if (token) {
    const base = process.env.API_BASE_URL ?? "http://localhost:4000";
    try {
      await fetch(`${base}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // API unreachable — local cookie clear is sufficient.
    }
  }

  // Clear with the SAME attributes (incl. parent Domain in prod) the cookie
  // was written with — otherwise a parent-domain session cookie would survive
  // a host-only expiry and the user would stay logged in.
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  redirect("/login");
}

/**
 * Server Action fetching the dashboard progress summary
 * (09c-v1-progress-dashboard-stats, Slice 2). Thin framework glue —
 * mirrors `getWorkoutHistoryAction`; the branching logic lives in the
 * unit-tested `dashboard-client.ts`.
 */
export async function getDashboardAction(): Promise<FetchDashboardSummaryResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchDashboardSummary(token);
}

/**
 * Confirm an adherence adaptation for `planSpecId` (14a-v1.1 Slice B1). Reads
 * the session cookie server-side and POSTs `{}` to `/plan-specs/:id/adapt` via
 * the internal API — the browser never calls the API directly and never sends a
 * target frequency (the server re-derives it). Returns a result the coach banner
 * branches on: an error (quota exhausted, stale recommendation, network) leaves
 * the plan unchanged and is shown inline. Thin framework glue; the branching
 * logic lives in the unit-tested `adaptPlan` client.
 */
export async function adaptPlanAction(planSpecId: string): Promise<AdaptPlanActionResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  // #260: forward the app locale for localized limitation warnings.
  const locale = await getLocale();
  const result = await adaptPlan(planSpecId, token, { locale });
  return result.kind === "ok" ? { kind: "ok" } : { kind: "error", message: result.message };
}
