"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/auth/session-cookie";

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
