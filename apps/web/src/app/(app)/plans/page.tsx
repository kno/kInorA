/**
 * /plans — Plans list page (17d PR A).
 *
 * Async server component that fetches every plan (with progress fields)
 * via `listPlansWithProgressAction()` and explicitly distinguishes three
 * states — ok-with-plans / ok-empty / fetch-failed — rather than collapsing
 * a failure into `[]` (the exact anti-pattern the `/plan` swallowed-error
 * fix in this same PR closes). No archive filter yet — that is PR B.
 */
import { getTranslations } from "next-intl/server";
import { listPlansWithProgressAction } from "./actions";
import { PlanList } from "./PlanList";

export default async function PlansPage() {
  const t = await getTranslations();
  const result = await listPlansWithProgressAction();

  return (
    <main className="kin-page">
      <h1 className="kin-title">{t("plans.title")}</h1>
      <p className="kin-text kin-muted">{t("plans.description")}</p>

      {result.kind !== "ok" ? (
        <div className="kin-card kin-card--center">
          <p className="kin-error" role="alert" data-testid="plans-list-error">
            {t("plans.error")}
          </p>
        </div>
      ) : result.plans.length === 0 ? (
        <div className="kin-card kin-card--center">
          <h2 className="kin-title">{t("plans.empty.title")}</h2>
          <p className="kin-text kin-muted">{t("plans.empty.desc")}</p>
          <a href="/create-plan" className="kin-btn kin-btn--accent">
            {t("plans.empty.cta")}
          </a>
        </div>
      ) : (
        <PlanList plans={result.plans} />
      )}
    </main>
  );
}
