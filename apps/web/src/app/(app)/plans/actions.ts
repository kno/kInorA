"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  archivePlan,
  fetchUserPlansWithProgress,
  unarchivePlan,
  type FetchPlansWithProgressResult,
} from "./plans-client";

/**
 * Server Action for the `/plans` list (17d PR A). Thin framework glue
 * (excluded from coverage; the branching logic lives in the unit-tested
 * `plans-client.ts`) — mirrors `listPlansAction` / `getWorkoutHistoryAction`.
 * Reads the opaque session token from the `kinora_session` httpOnly cookie;
 * the browser never calls the API directly.
 */
export async function listPlansWithProgressAction(): Promise<FetchPlansWithProgressResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchUserPlansWithProgress(token);
}

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

/**
 * Server Action for archiving a plan from `/plans` (17d PR B). `PlanList`
 * applies the returned `archivedAt` optimistically and never reloads the
 * page, so this revalidates `/plans` and `/plan` server-side anyway — a
 * second tab, or this same tab after a future navigation, must not keep
 * rendering the plan in the default list.
 */
export async function archivePlanAction(
  planId: string,
): Promise<{ id: string; archivedAt: string | null } | null> {
  const token = await sessionToken();
  const result = await archivePlan(planId, token);
  if (result.kind !== "ok") {
    return null;
  }
  revalidatePath("/plans");
  revalidatePath("/plan");
  return { id: result.id, archivedAt: result.archivedAt };
}

/** Server Action for unarchiving a plan from `/plans` (17d PR B). */
export async function unarchivePlanAction(
  planId: string,
): Promise<{ id: string; archivedAt: string | null } | null> {
  const token = await sessionToken();
  const result = await unarchivePlan(planId, token);
  if (result.kind !== "ok") {
    return null;
  }
  revalidatePath("/plans");
  revalidatePath("/plan");
  return { id: result.id, archivedAt: result.archivedAt };
}
