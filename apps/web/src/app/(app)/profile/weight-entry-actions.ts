"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  createWeightEntry,
  type CreateWeightEntryResult,
} from "./weight-entry-client";

/**
 * Create-weight-entry Server Action (17c-profile-body-metrics, PR 2).
 *
 * Thin framework glue (excluded from coverage; the branching logic lives in
 * the unit-tested `weight-entry-client.ts`) — mirrors `actions.ts`'s
 * `saveProfileAction` exactly: reads the opaque session token from the
 * `kinora_session` httpOnly cookie and forwards it as a Bearer token to the
 * API server-to-server. The browser NEVER calls the API directly.
 */
export async function createWeightEntryAction(
  weightKg: number,
  recordedAt?: string,
): Promise<CreateWeightEntryResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return createWeightEntry(token, { weightKg, recordedAt });
}
