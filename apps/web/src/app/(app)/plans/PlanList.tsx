"use client";

/**
 * PlanList — presentational client component for the `/plans` surface
 * (17d PR A). Renders every plan with its progress fields, the currently-
 * followed plan spanning two columns with a badge, and — for `generating`/
 * `failed` plans — the SAME status copy `/plan` already shows, per the
 * Open Design mock's blocked-button contract: an action that cannot apply
 * to a non-`ready` row is `disabled` + `aria-disabled` + an explanatory
 * `title`, never silently absent.
 *
 * No archive/edit affordances here — those are PR B/PR D. This component
 * does not implement the Open Design mock's prototype state-switcher (out
 * of scope by design, per tasks.md A.10).
 */
import { useTranslations, useFormatter } from "next-intl";
import type { WorkoutPlanSummary } from "@kinora/contracts";
import styles from "./PlanList.module.css";

export interface PlanListProps {
  plans: WorkoutPlanSummary[];
  /** Injectable "now" for deterministic age-coloring in tests. Defaults to `new Date()`. */
  now?: Date;
}

const RECENT_DAYS = 7;
const AGING_DAYS = 30;

type AgeBand = "recent" | "aging" | "stale" | undefined;

function ageBand(lastTrainedAt: string | undefined, now: Date): AgeBand {
  if (!lastTrainedAt) return undefined;
  const ageDays = (now.getTime() - new Date(lastTrainedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= RECENT_DAYS) return "recent";
  if (ageDays <= AGING_DAYS) return "aging";
  return "stale";
}

function ageClassName(band: AgeBand): string {
  switch (band) {
    case "recent":
      return styles.lastTrainedRecent ?? "";
    case "aging":
      return styles.lastTrainedAging ?? "";
    case "stale":
      return styles.lastTrainedStale ?? "";
    default:
      return "";
  }
}

export function PlanList({ plans, now = new Date() }: PlanListProps) {
  const t = useTranslations();
  const format = useFormatter();

  // The plan currently being followed: the FIRST ready plan in the caller's
  // own newest-first list — `findLatestReadyByOwner`'s "latest ready" notion,
  // adapted client-side to this list instead of a second query.
  const currentPlanId = plans.find((plan) => plan.status === "ready")?.id;

  return (
    <div className={styles.grid}>
      {plans.map((plan) => {
        const isCurrent = plan.id === currentPlanId;
        const band = ageBand(plan.lastTrainedAt, now);

        return (
          <div
            key={plan.id}
            data-testid={`plan-card-${plan.id}`}
            className={`kin-card ${isCurrent ? styles.currentPlan : ""}`}
          >
            {isCurrent && (
              <span className={styles.badge}>{t("plans.list.currentlyFollowing")}</span>
            )}
            <h2 className="kin-title">{plan.name}</h2>

            {plan.status === "generating" && (
              <>
                <p className="kin-text">{t("plan.generating.title")}</p>
                <p className="kin-text kin-muted">{t("plan.generating.desc")}</p>
              </>
            )}
            {plan.status === "failed" && (
              <>
                <p className="kin-text">{t("plan.failed.title")}</p>
                <p className="kin-text kin-muted">{t("plan.failed.desc")}</p>
              </>
            )}

            {plan.daysPerWeek !== undefined && (
              <p className="kin-text kin-muted">
                {t("plans.list.daysPerWeek", { days: plan.daysPerWeek })}
              </p>
            )}
            <p className="kin-text kin-muted">
              {t("plans.list.completedSessions", { count: plan.completedSessions ?? 0 })}
            </p>
            <p
              className={`kin-text ${ageClassName(band)}`}
              data-testid={`plan-last-trained-${plan.id}`}
            >
              {plan.lastTrainedAt
                ? t("plans.list.lastTrained", {
                    date: format.dateTime(new Date(plan.lastTrainedAt), {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    }),
                  })
                : t("plans.list.neverTrained")}
            </p>

            {plan.status === "ready" ? (
              <a
                href={`/plan?planId=${plan.id}`}
                className="kin-btn kin-btn--accent"
                data-testid={`plan-open-${plan.id}`}
              >
                {t("plans.list.open")}
              </a>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title={t(`plans.list.openDisabled.${plan.status === "generating" ? "generating" : "failed"}`)}
                className="kin-btn kin-btn--ghost"
                data-testid={`plan-open-${plan.id}`}
              >
                {t("plans.list.open")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default PlanList;
