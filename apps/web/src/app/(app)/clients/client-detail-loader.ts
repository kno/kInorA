import type { ReactNode } from "react";
import type { StatsRange } from "@/app/(app)/stats/stats-client";
import {
  getClientDashboardAction,
  getClientExerciseDetailAction,
  getClientProgressStatsAction,
  getClientWeeklyOverviewAction,
} from "./actions";
import { DashboardTab, ProgressTab, PlanTab, type DetailTab, type Translator } from "./[clientUserId]/ClientDetailSections";

/**
 * Shared tab-resolution/loading for the trainer client-detail body (GH #447,
 * then the workspace closeout). Both the standalone `/clients/[clientUserId]`
 * route and the `/clients` master-detail workspace render the exact same
 * Dashboard/Progress/Plan body for a given `(clientUserId, tab, searchParams)`
 * — this is the ONE place that decides which action to call and builds the
 * `ReactNode`, so the two routes cannot silently drift.
 */

export interface ClientDetailSearchParams {
  tab?: string;
  range?: string;
  exercise?: string;
  weekStart?: string;
}

export function normalizeTab(value: string | undefined): DetailTab {
  return value === "progress" || value === "plan" ? value : "dashboard";
}

export function normalizeRange(value: string | undefined): StatsRange {
  return value === "week" || value === "year" ? value : "month";
}

/**
 * Called as a plain function (not a JSX tag) — mirrors `stats/page.tsx`'s
 * `StatsBody({...})` convention: a JSX element wrapping this async function
 * would defer its fetch past the caller's own `await` boundary, which breaks
 * tests inspecting the returned element tree synchronously-after-await and
 * (in the "progress" case) would fire the exercise-detail fetch as an
 * unawaited side effect.
 */
export async function loadClientDetailBody(
  clientUserId: string,
  tab: DetailTab,
  sp: ClientDetailSearchParams,
  t: Translator,
  /** See {@link import("./[clientUserId]/ClientDetailSections").ClientDetailHeaderProps.hrefBase}. */
  hrefBase?: string,
): Promise<ReactNode> {
  if (tab === "dashboard") {
    return DashboardTab({ result: await getClientDashboardAction(clientUserId), t });
  }

  if (tab === "progress") {
    const range = normalizeRange(sp.range);
    const statsResult = await getClientProgressStatsAction(clientUserId, range);
    const exerciseResult = sp.exercise ? await getClientExerciseDetailAction(clientUserId, sp.exercise) : undefined;
    return ProgressTab({ clientUserId, range, statsResult, exerciseTitle: sp.exercise, exerciseResult, t, hrefBase });
  }

  const weekResult = await getClientWeeklyOverviewAction(clientUserId, sp.weekStart);
  return PlanTab({ clientUserId, weekResult, t, hrefBase });
}
