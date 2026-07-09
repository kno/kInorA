/**
 * /plan — Plan tab page.
 *
 * Async server component that:
 *  1. Calls listPlansAction() to get the user's plan summaries (newest-first).
 *  2. Resolves selectedId from searchParams.planId ?? summaries[0].id.
 *  3. Fetches the selected plan's detail via getPlanStatusAction(selectedId).
 *  4. Handles four states:
 *     - generating → redirect to /plan/[id] (live WS view)
 *     - ready       → PlanWeekView (4-tile summary + day-card grid)
 *     - failed      → PlanStatusView failed + link to /plan/[id]
 *     - empty       → empty state card + /create-plan CTA (no selector)
 *  5. Renders PlanSelector when multiple plans exist.
 *
 * searchParams is a Promise in Next 15+ (async searchParams). Await it.
 */
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listPlansAction } from "./actions";
import { getPlanStatusAction } from "./[id]/actions";
import { PlanStatusView } from "./[id]/PlanStatusView";
import { PlanSelector } from "./PlanSelector";
import { PlanWeekView } from "./PlanWeekView";
import type { WorkoutProgram } from "@kinora/contracts";

interface PlanPageProps {
  searchParams: Promise<{ planId?: string }>;
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const params = await searchParams;
  const t = await getTranslations();

  // 1. List all plans (fail-open: error → empty state)
  const listResult = await listPlansAction();
  const summaries = listResult.kind === "ok" ? listResult.plans : [];

  // 2. Empty state — no plans
  if (summaries.length === 0) {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("plan.nav.empty.title")}</h1>
          <p className="kin-text kin-muted">{t("plan.nav.empty.desc")}</p>
          <a href="/create-plan" className="kin-btn kin-btn--primary">
            {t("plan.nav.empty.cta")}
          </a>
        </div>
      </main>
    );
  }

  // 3. Resolve selectedId (param → latest)
  const requestedId = params.planId;
  const defaultId = summaries[0]!.id;
  const selectedId = requestedId ?? defaultId;

  // 4. Fetch detail for the selected plan
  let detailResult = await getPlanStatusAction(selectedId);

  // 5. Unowned / not-found fallback — retry with the latest plan
  if (detailResult.kind === "error" && selectedId !== defaultId) {
    detailResult = await getPlanStatusAction(defaultId);
  }

  // If still error after fallback, render empty state
  if (detailResult.kind === "error") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("plan.nav.empty.title")}</h1>
          <p className="kin-text kin-muted">{t("plan.nav.empty.desc")}</p>
          <a href="/create-plan" className="kin-btn kin-btn--primary">
            {t("plan.nav.empty.cta")}
          </a>
        </div>
      </main>
    );
  }

  const plan = detailResult.plan;
  const resolvedId = plan.id;

  // 6. Generating → redirect to live WS view
  if (plan.status === "generating") {
    redirect(`/plan/${resolvedId}`);
  }

  // 7. Render selector (when >1 plan) + selected plan state
  const showSelector = summaries.length > 1;

  if (plan.status === "failed") {
    return (
      <main className="kin-page">
        {showSelector && <PlanSelector summaries={summaries} selectedId={resolvedId} />}
        <PlanStatusView planId={resolvedId} status="failed" specId={plan.specId} />
        <div className="kin-card kin-card--center">
          <a href={`/plan/${resolvedId}`} className="kin-link">
            {t("plan.viewDetailsOrRegenerate")}
          </a>
        </div>
      </main>
    );
  }

  // status === "ready" — render the week-view layout (PlanWeekView server component)
  return (
    <main className="kin-page">
      {showSelector && <PlanSelector summaries={summaries} selectedId={resolvedId} />}
      <PlanWeekView
        program={plan.program as WorkoutProgram}
        planName={plan.name}
        planId={resolvedId}
      />
    </main>
  );
}
