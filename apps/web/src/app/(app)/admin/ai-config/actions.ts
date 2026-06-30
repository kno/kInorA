"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import {
  updateAiConfig,
  type AiProvider,
  type UpdateConfigResult,
} from "./ai-config-client";

/**
 * Server Action for the AI provider admin panel.
 *
 * Thin framework glue (excluded from coverage; the branching logic lives in the
 * unit-tested `ai-config-client.ts`). Reads the opaque session token from the
 * `kinora_session` httpOnly cookie and forwards it as a Bearer token to the API
 * server-to-server — mirroring `create-plan/actions.ts`.
 *
 * The browser NEVER calls the API directly: the client form invokes this action,
 * Next.js runs it on the server (where API_BASE_URL=http://api:4000 resolves), and
 * the session token stays server-side (never reaches client JS).
 */
export async function updateAiConfigAction(
  provider: AiProvider,
  model: string,
): Promise<UpdateConfigResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return updateAiConfig(token, provider, model);
}
