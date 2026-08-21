"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import type { StatsRange } from "@/app/(app)/stats/stats-client";
import {
  createPlanForClient,
  fetchClientDashboard,
  fetchClientExerciseDetail,
  fetchClientPlan,
  fetchClientProgressStats,
  fetchClients,
  fetchClientWeeklyOverview,
  inviteClient,
} from "./trainer-client";
import type {
  CreatePlanForClientInput,
  CreatePlanForClientResult,
  FetchClientDashboardResult,
  FetchClientExerciseDetailResult,
  FetchClientPlanResult,
  FetchClientProgressStatsResult,
  FetchClientsResult,
  FetchClientWeeklyOverviewResult,
  InviteClientResult,
} from "./trainer-client-types";

/**
 * Server Actions for the trainer client-list surface (15a-v2-trainer-account-
 * access, Slice 5). Thin framework glue — mirrors `dashboard/actions.ts`; the
 * branching logic lives in the unit-tested `trainer-client.ts`.
 */

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function getClientsAction(): Promise<FetchClientsResult> {
  const token = await sessionToken();
  return fetchClients(token);
}

export async function inviteClientAction(email: string): Promise<InviteClientResult> {
  const token = await sessionToken();
  return inviteClient(token, email);
}

export async function createPlanForClientAction(
  clientUserId: string,
  input: CreatePlanForClientInput,
): Promise<CreatePlanForClientResult> {
  const token = await sessionToken();
  return createPlanForClient(clientUserId, input, token);
}

/** Read an assigned client's plan detail (#341). Authorization is server-side. */
export async function getClientPlanAction(
  clientUserId: string,
  planId: string,
): Promise<FetchClientPlanResult> {
  const token = await sessionToken();
  return fetchClientPlan(clientUserId, planId, token);
}

/** Read an assigned client's dashboard summary (GH #447). Authorization is server-side. */
export async function getClientDashboardAction(clientUserId: string): Promise<FetchClientDashboardResult> {
  const token = await sessionToken();
  return fetchClientDashboard(clientUserId, token);
}

/** Read an assigned client's statistics summary (GH #447). Authorization is server-side. */
export async function getClientProgressStatsAction(
  clientUserId: string,
  range: StatsRange,
): Promise<FetchClientProgressStatsResult> {
  const token = await sessionToken();
  return fetchClientProgressStats(clientUserId, range, token);
}

/** Read an assigned client's exercise-history reference (GH #447). Authorization is server-side. */
export async function getClientExerciseDetailAction(
  clientUserId: string,
  title: string,
): Promise<FetchClientExerciseDetailResult> {
  const token = await sessionToken();
  return fetchClientExerciseDetail(clientUserId, title, token);
}

/** Read an assigned client's weekly plan-board overview (GH #447). Authorization is server-side. */
export async function getClientWeeklyOverviewAction(
  clientUserId: string,
  weekStart: string | undefined,
): Promise<FetchClientWeeklyOverviewResult> {
  const token = await sessionToken();
  return fetchClientWeeklyOverview(clientUserId, weekStart, token);
}
