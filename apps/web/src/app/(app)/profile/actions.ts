"use server";

import { cookies } from "next/headers";
import type { PlanGoal, ExperienceLevel } from "@kinora/contracts";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  updateUserProfile,
  type SaveProfileResult,
} from "./profile-form-client";

/**
 * Save-profile Server Action (Slice 4 of 10a-user-memory-structured).
 *
 * Thin framework glue (excluded from coverage; the branching logic lives in
 * the unit-tested `profile-form-client.ts`). Reads the opaque session token
 * from the `kinora_session` httpOnly cookie and forwards it as a Bearer token
 * to the API server-to-server — mirroring `admin/ai-config/actions.ts`.
 *
 * The browser NEVER calls the API directly: the client form invokes this
 * action, Next.js runs it on the server (where `API_BASE_URL=http://api:4000`
 * resolves), and the session token stays server-side (never reaches client JS).
 *
 * `null` selectors are passed through and omitted by the client helper so the
 * stored value is preserved (partial-merge semantics live in the API route).
 */
export async function saveProfileAction(
  name: string,
  goal: PlanGoal | null,
  experienceLevel: ExperienceLevel | null,
): Promise<SaveProfileResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return updateUserProfile(token, { name, goal, experienceLevel });
}