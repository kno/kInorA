"use server";

import { cookies } from "next/headers";
import type { BillingCycle } from "@kinora/contracts";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  getBillingInvoices,
  getBillingVisibility,
  openPortal,
  startCheckout,
  type GetBillingInvoicesResult,
  type GetBillingVisibilityResult,
  type OpenPortalResult,
  type StartCheckoutResult,
} from "./billing-client";

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

/**
 * Server Action re-fetching the owner-only invoice history for the CURRENT
 * session's tenant. Refreshed alongside visibility on tenant switch so a
 * non-owner tenant never keeps showing the previous tenant's invoices or
 * owner-only actions (a `forbidden` result hides them).
 */
export async function getBillingInvoicesAction(): Promise<GetBillingInvoicesResult> {
  return getBillingInvoices(await sessionToken());
}

/**
 * Server Action starting a Stripe-hosted checkout for the selected cycle. The
 * tenant is bound server-side from the session; the client only supplies the
 * cycle + optional promotion code and redirects to the returned URL. Keeping
 * this server-side ensures the session token never reaches the client bundle.
 */
export async function startCheckoutAction(
  cycle: BillingCycle,
  promotionCode?: string,
): Promise<StartCheckoutResult> {
  return startCheckout(await sessionToken(), cycle, promotionCode);
}

/**
 * Server Action opening the Stripe Customer Portal (owner-only). Returns
 * `forbidden` for a non-owner so the client can degrade gracefully.
 */
export async function openPortalAction(): Promise<OpenPortalResult> {
  return openPortal(await sessionToken());
}
