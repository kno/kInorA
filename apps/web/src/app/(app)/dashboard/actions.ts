"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchDashboardSummary, type FetchDashboardSummaryResult } from "./dashboard-client";

/**
 * Logout Server Action.
 *
 * Clears the `kinora_session` cookie and redirects to the login page.
 * The session in the DB will expire naturally (30-day TTL). A proper
 * API-backed logout that also invalidates the DB session can be added
 * when the `POST /auth/logout` endpoint is wired to the web app.
 */
export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
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
