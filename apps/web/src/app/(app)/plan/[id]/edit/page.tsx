/**
 * /plan/[id]/edit — hand-edit a ready plan's program (17d PR D).
 *
 * Async server component. It distinguishes FOUR states rather than collapsing
 * them: a genuine 404, a failed read, a plan that is not editable yet
 * (generating/failed, or ready with no program), and the editable case. The
 * failed read matters most — rendering an empty form over a fetch that failed
 * would invite the user to save that blankness over a program that is still
 * perfectly fine on the server.
 */
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { WorkoutProgram } from "@kinora/contracts";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchPlanStatus } from "@/app/(app)/create-plan/plan-draft-client";
import { ProgramEditor } from "./ProgramEditor";

interface ProgramEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProgramEditPage({ params }: ProgramEditPageProps) {
  const { id: planId } = await params;
  const t = await getTranslations();

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const result = await fetchPlanStatus(planId, token);

  if (result.kind === "error" && result.message === "not_found") {
    notFound();
  }

  if (result.kind !== "ok") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("planEdit.loadError.title")}</h1>
          <p className="kin-error" role="alert" data-testid="plan-edit-load-error">
            {t("planEdit.loadError.desc")}
          </p>
        </div>
      </main>
    );
  }

  const plan = result.plan;
  const program = plan.program as WorkoutProgram | undefined;

  // A plan without a stored program has nothing to edit, and neither does one
  // that is still generating or has failed — the server refuses both with a
  // 409, so saying so here saves a pointless round-trip.
  if (plan.status !== "ready" || !program || !plan.updatedAt) {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("planEdit.notReady.title")}</h1>
          <p className="kin-text kin-muted" data-testid="plan-edit-not-ready">
            {t("planEdit.notReady.desc")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="kin-page">
      <ProgramEditor
        planId={plan.id}
        planName={plan.name}
        program={program}
        updatedAt={plan.updatedAt}
      />
    </main>
  );
}
