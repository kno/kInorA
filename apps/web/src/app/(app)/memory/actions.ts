"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  createUserMemory,
  deleteUserMemory,
  listUserMemories,
  updateMemorySettings,
  type CreateUserMemoryResult,
  type DeleteUserMemoryResult,
  type ListUserMemoriesResult,
  type UpdateMemorySettingsResult,
} from "./memory-client";

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function getUserMemoriesAction(): Promise<ListUserMemoriesResult> {
  return listUserMemories(await sessionToken());
}

export async function createUserMemoryAction(input: {
  factText: string;
}): Promise<CreateUserMemoryResult> {
  return createUserMemory(await sessionToken(), {
    factText: input.factText,
    source: "user_confirmation",
    idempotencyKey: randomUUID(),
  });
}

export async function deleteUserMemoryAction(id: string): Promise<DeleteUserMemoryResult> {
  return deleteUserMemory(await sessionToken(), id);
}

export async function updateMemorySettingsAction(
  enabled: boolean,
): Promise<UpdateMemorySettingsResult> {
  return updateMemorySettings(await sessionToken(), { enabled });
}
