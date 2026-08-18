import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { StatsRange } from "@/app/(app)/stats/stats-client";
import {
  getClientDashboardAction,
  getClientExerciseDetailAction,
  getClientProgressStatsAction,
  getClientsAction,
  getClientWeeklyOverviewAction,
} from "../actions";
import { ClientDetailHeader, DashboardTab, ProgressTab, PlanTab, type DetailTab } from "./ClientDetailSections";

/**
 * Trainer client-detail page (GH #447, PR 2/2 — web). Built to
 * `web-clients.html`'s detail panel: identity header, Dashboard/Progress/Plan
 * tabs, all URL-driven (`?tab=&range=&exercise=&weekStart=`) so each tab is a
 * plain server-rendered read — no client-side tab-switching JS.
 *
 * Identity comes from `GET /trainer/clients` (already fetched by the list
 * page) rather than a new endpoint — that read is the only place the web app
 * learns a client's email/status. `forbidden` (not an entitled trainer) and
 * "this client isn't in your roster" (a real `clientUserId` the trainer just
 * isn't assigned to) are DISTINCT honest states, neither invented.
 */

interface ClientDetailPageProps {
  params: Promise<{ clientUserId: string }>;
  searchParams: Promise<{ tab?: string; range?: string; exercise?: string; weekStart?: string }>;
}

function normalizeTab(value: string | undefined): DetailTab {
  return value === "progress" || value === "plan" ? value : "dashboard";
}

function normalizeRange(value: string | undefined): StatsRange {
  return value === "week" || value === "year" ? value : "month";
}

export default async function ClientDetailPage({ params, searchParams }: ClientDetailPageProps) {
  const { clientUserId } = await params;
  const sp = (await searchParams) ?? {};
  const tab = normalizeTab(sp.tab);
  const t = await getTranslations();

  const clientsResult = await getClientsAction();

  if (clientsResult.kind === "forbidden") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("clients.accessRestrictedTitle")}</h1>
        <p className="kin-text kin-muted">{t("clients.accessRestrictedBody")}</p>
      </main>
    );
  }

  if (clientsResult.kind === "error") {
    return (
      <main className="kin-page">
        <p className="kin-text" role="alert">
          {t("clients.loadError")}
        </p>
      </main>
    );
  }

  const client = clientsResult.clients.find((candidate) => candidate.clientUserId === clientUserId);
  if (!client) {
    return (
      <main className="kin-page">
        <p className="kin-text kin-muted" data-testid="client-detail-not-found">
          {t("clients.detail.notFound")}
        </p>
      </main>
    );
  }

  // Called as plain functions (not JSX tags) — mirrors `stats/page.tsx`'s
  // `StatsBody({...})` convention: a JSX element wrapping an async/lazily-
  // evaluated component would defer the fetch and the render past this
  // function's own `await` boundary, which both breaks tests that inspect
  // the returned element tree synchronously-after-await and (in the
  // "progress" case) would fetch exercise detail as an unawaited side effect.
  let body: ReactNode;
  if (tab === "dashboard") {
    body = DashboardTab({ result: await getClientDashboardAction(clientUserId), t });
  } else if (tab === "progress") {
    const range = normalizeRange(sp.range);
    const statsResult = await getClientProgressStatsAction(clientUserId, range);
    const exerciseResult = sp.exercise ? await getClientExerciseDetailAction(clientUserId, sp.exercise) : undefined;
    body = ProgressTab({ clientUserId, range, statsResult, exerciseTitle: sp.exercise, exerciseResult, t });
  } else {
    const weekResult = await getClientWeeklyOverviewAction(clientUserId, sp.weekStart);
    body = PlanTab({ clientUserId, weekResult, t });
  }

  return (
    <main className="kin-page" data-testid="client-detail-page">
      {ClientDetailHeader({ client, tab, t })}
      {body}
    </main>
  );
}
