"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { getBillingVisibility, type GetBillingVisibilityResult } from "./billing-client";

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

/**
 * Server Action re-fetching billing visibility for the CURRENT session's
 * tenant. Called by the client on mount refresh and tab-focus (tenant
 * switch) — always reads the current cookie, so a session bound to a
 * different tenant naturally returns that tenant's state only.
 */
export async function getBillingVisibilityAction(): Promise<GetBillingVisibilityResult> {
  return getBillingVisibility(await sessionToken());
}
