"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchStatsSummary, type FetchStatsSummaryResult, type StatsRange } from "./stats-client";

/**
 * Server Action fetching the statistics summary (Slice 3a). Thin framework
 * glue — mirrors `getDashboardAction`; the branching logic lives in the
 * unit-tested `stats-client.ts`.
 */
export async function getStatsAction(range: StatsRange): Promise<FetchStatsSummaryResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return fetchStatsSummary(token, range);
}
