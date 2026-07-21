"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchDashboardSummary, type FetchDashboardSummaryResult } from "./dashboard-client";

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
