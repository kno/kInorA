"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { createPlanForClient, fetchClientPlan, fetchClients, inviteClient } from "./trainer-client";
import type {
  CreatePlanForClientInput,
  CreatePlanForClientResult,
  FetchClientPlanResult,
  FetchClientsResult,
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
