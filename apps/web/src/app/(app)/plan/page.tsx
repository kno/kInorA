/**
 * /plan — Plan tab page.
 *
 * Async server component that:
 *  1. Calls listPlansAction() to get the user's plan summaries (newest-first).
 *  2. Resolves selectedId from searchParams.planId ?? summaries[0].id.
 *  3. Fetches the selected plan's detail via getPlanStatusAction(selectedId).
 *  4. Handles four states:
 *     - generating → redirect to /plan/[id] (live WS view)
 *     - ready       → PlanStatusView ready
 *     - failed      → PlanStatusView failed + link to /plan/[id]
 *     - empty       → empty state card + /create-plan CTA (no selector)
 *  5. Renders PlanSelector when multiple plans exist.
 *
 * searchParams is a Promise in Next 15+ (async searchParams). Await it.
 */
import { redirect } from "next/navigation";
import { listPlansAction } from "./actions";
import { getPlanStatusAction } from "./[id]/actions";
import { PlanStatusView } from "./[id]/PlanStatusView";
import { PlanSelector } from "./PlanSelector";
import type { WorkoutProgram } from "@kinora/contracts";

interface PlanPageProps {
  searchParams: Promise<{ planId?: string }>;
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const params = await searchParams;

  // 1. List all plans (fail-open: error → empty state)
  const listResult = await listPlansAction();
  const summaries = listResult.kind === "ok" ? listResult.plans : [];

  // 2. Empty state — no plans
  if (summaries.length === 0) {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">No plan yet</h1>
          <p className="kin-text kin-muted">
            Create your personalized workout plan to get started.
          </p>
          <a href="/create-plan" className="kin-btn kin-btn--primary">
            Create your plan
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
          <h1 className="kin-title">No plan yet</h1>
          <p className="kin-text kin-muted">
            Create your personalized workout plan to get started.
          </p>
          <a href="/create-plan" className="kin-btn kin-btn--primary">
            Create your plan
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
        {showSelector && (
          <PlanSelector summaries={summaries} selectedId={resolvedId} />
        )}
        <PlanStatusView
          planId={resolvedId}
          status="failed"
          specId={plan.specId}
        />
        <div className="kin-card kin-card--center">
          <a href={`/plan/${resolvedId}`} className="kin-link">
            View details or regenerate
          </a>
        </div>
      </main>
    );
  }

  // status === "ready"
  return (
    <main className="kin-page">
      {showSelector && (
        <PlanSelector summaries={summaries} selectedId={resolvedId} />
      )}
      <PlanStatusView
        planId={resolvedId}
        status="ready"
        program={plan.program as WorkoutProgram | undefined}
        specId={plan.specId}
      />
    </main>
  );
}
