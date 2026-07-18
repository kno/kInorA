"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchExerciseDetail, type FetchExerciseDetailResult } from "./exercise-detail-client";

/**
 * Server Action fetching the read-only exercise-history reference
 * (09c-v1-progress-dashboard-stats, Slice 4b). Thin framework glue — mirrors
 * `getDashboardAction`; the branching logic lives in the unit-tested
 * `exercise-detail-client.ts`.
 */
export async function getExerciseDetailAction(title: string): Promise<FetchExerciseDetailResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchExerciseDetail(token, title);
}
