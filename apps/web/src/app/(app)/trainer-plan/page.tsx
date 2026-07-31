/**
 * /trainer-plan — client-facing branded-plan view
 * (15b-v2-trainer-dashboard-branding, Phase S5).
 *
 * Async server component that fetches the caller's own trainer-built plan via
 * `getTrainerPlanAction()` (which calls `GET /me/trainer-plan`, authorized by
 * the S2 `resolveClientTrainerTenant` primitive) and renders three states:
 *   - error (403 no active assignment, or any other failure) → a minimal
 *     "no trainer plan" notice. The S2 deny-by-default authorization is never
 *     weakened here — this page renders whatever the API decided.
 *   - not "ready" (generating/failed) → a minimal "still preparing" notice
 *     (no regenerate CTA — that stays trainer-controlled, out of this
 *     minimal client view's scope).
 *   - "ready" → `PlanWeekView` (the SAME branding-aware view the self-serve
 *     `/plan` page uses), passed the `branding` the API resolved.
 *
 * Intentionally minimal (design.md: "not a full client dashboard") — no plan
 * selector, no tracker wiring, no regenerate/adapt actions.
 */
import { getTranslations } from "next-intl/server";
import type { WorkoutProgram } from "@kinora/contracts";
import { getTrainerPlanAction } from "./actions";
import { PlanWeekView } from "../plan/PlanWeekView";

export default async function TrainerPlanPage() {
  const t = await getTranslations();
  const result = await getTrainerPlanAction();

  if (result.kind === "error") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("trainerPlan.denied.title")}</h1>
          <p className="kin-text kin-muted">{t("trainerPlan.denied.desc")}</p>
        </div>
      </main>
    );
  }

  const plan = result.plan;

  if (plan.status !== "ready") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("trainerPlan.pending.title")}</h1>
          <p className="kin-text kin-muted">{t("trainerPlan.pending.desc")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="kin-page">
      <PlanWeekView
        program={plan.program as WorkoutProgram}
        planName={plan.name}
        planId={plan.id}
        branding={plan.branding}
      />
    </main>
  );
}
