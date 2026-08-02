"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  searchTenants,
  fetchTenantOverrideStatus,
  grantTierOverride,
  revokeTierOverride,
} from "./tenant-provisioning-client";
import type {
  FetchStatusResult,
  GrantOverrideRequest,
  GrantResult,
  RevokeResult,
  SearchTenantsResult,
} from "./tenant-provisioning-constants";

/**
 * Server Actions for the tenant-provisioning admin panel (GH #307).
 *
 * Thin framework glue (the branching logic lives in the unit-tested
 * `tenant-provisioning-client.ts`). Each reads the opaque session token from
 * the `kinora_session` httpOnly cookie and forwards it as a Bearer token to
 * the API server-to-server — the browser never calls the API directly, and the
 * token never reaches client JS. Mirrors `ai-config/actions.ts`.
 */

async function token(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function searchTenantsAction(query: string): Promise<SearchTenantsResult> {
  return searchTenants(await token(), query);
}

export async function fetchStatusAction(tenantId: string): Promise<FetchStatusResult> {
  return fetchTenantOverrideStatus(await token(), tenantId);
}

export async function grantAction(
  tenantId: string,
  input: GrantOverrideRequest,
): Promise<GrantResult> {
  return grantTierOverride(await token(), tenantId, input);
}

export async function revokeAction(tenantId: string): Promise<RevokeResult> {
  return revokeTierOverride(await token(), tenantId);
}
