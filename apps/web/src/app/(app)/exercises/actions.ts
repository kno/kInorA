"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchExerciseDetail, type FetchExerciseDetailResult } from "./exercise-detail-client";
import {
  fetchExerciseCatalogDetail,
  fetchExerciseCatalogFacets,
  fetchExerciseCatalogList,
  type ExerciseCatalogFacetQuery,
  type ExerciseCatalogQuery,
  type FetchExerciseCatalogDetailResult,
  type FetchExerciseCatalogFacetsResult,
  type FetchExerciseCatalogListResult,
} from "./exercise-catalog-client";

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

/**
 * Server Action listing a filtered page of the exercise library. Thin
 * framework glue over `fetchExerciseCatalogList` — see that module for why
 * filtering and pagination stay server-side.
 */
export async function listExerciseCatalogAction(
  query: ExerciseCatalogQuery
): Promise<FetchExerciseCatalogListResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchExerciseCatalogList(token, query);
}

/** Server Action fetching one library exercise's full detail. */
export async function getExerciseCatalogDetailAction(
  id: string
): Promise<FetchExerciseCatalogDetailResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchExerciseCatalogDetail(token, id);
}

/**
 * Server Action fetching the distinct filter values for the library chips,
 * scoped to the currently active filters so counts always match the current
 * result set (design §2/§3). Defaults to no filter — a whole-catalog tally,
 * same as today.
 */
export async function getExerciseCatalogFacetsAction(
  query: ExerciseCatalogFacetQuery = {}
): Promise<FetchExerciseCatalogFacetsResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchExerciseCatalogFacets(token, query);
}
