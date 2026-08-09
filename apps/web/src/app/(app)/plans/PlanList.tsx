"use client";

/**
 * PlanList — presentational client component for the `/plans` surface
 * (17d PR A, archive PR B). Renders every plan with its progress fields, the
 * currently-followed plan spanning two columns with a badge, and — for
 * `generating`/`failed` plans — the SAME status copy `/plan` already shows,
 * per the Open Design mock's blocked-button contract: an action that cannot
 * apply to a non-`ready` row is `disabled` + `aria-disabled` + an explanatory
 * `title`, never silently absent.
 *
 * 17d PR B: archived plans are excluded from the default grid and revealed
 * only in their own section, below a separator, behind a show-archived
 * toggle. Archive/unarchive are optimistic — `plans` starts from props but is
 * copied into local state so a successful call moves a plan between sections
 * without a full page reload (`router.refresh()`/navigation is deliberately
 * NOT used here). `onArchive`/`onUnarchive` default to the real server
 * actions; tests inject fakes.
 *
 * This component does not implement the Open Design mock's prototype
 * state-switcher control (out of scope by design, per tasks.md A.10).
 */
import * as React from "react";
import { useTranslations, useFormatter } from "next-intl";
import type { WorkoutPlanSummary } from "@kinora/contracts";
import styles from "./PlanList.module.css";
import { archivePlanAction, unarchivePlanAction } from "./actions";

type ArchiveResult = { id: string; archivedAt: string | null } | null;

export interface PlanListProps {
  plans: WorkoutPlanSummary[];
  /** Injectable "now" for deterministic age-coloring in tests. Defaults to `new Date()`. */
  now?: Date;
  /** Defaults to the real `archivePlanAction`. Injectable for tests. */
  onArchive?: (id: string) => Promise<ArchiveResult>;
  /** Defaults to the real `unarchivePlanAction`. Injectable for tests. */
  onUnarchive?: (id: string) => Promise<ArchiveResult>;
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

export function PlanList({
  plans: initialPlans,
  now = new Date(),
  onArchive = (id: string) => archivePlanAction(id),
  onUnarchive = (id: string) => unarchivePlanAction(id),
}: PlanListProps) {
  const t = useTranslations();
  const format = useFormatter();
  const [plans, setPlans] = React.useState(initialPlans);
  const [showArchived, setShowArchived] = React.useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = React.useState<string | null>(null);

  const activePlans = plans.filter((plan) => !plan.archivedAt);
  const archivedPlans = plans.filter((plan) => plan.archivedAt);

  // The plan currently being followed: the FIRST ready plan in the caller's
  // own newest-first list — `findLatestReadyByOwner`'s "latest ready" notion,
  // adapted client-side to this list instead of a second query.
  const currentPlanId = activePlans.find((plan) => plan.status === "ready")?.id;

  function applyArchiveResult(id: string, result: ArchiveResult) {
    if (!result) return;
    setPlans((prev) =>
      prev.map((plan) => (plan.id === id ? { ...plan, archivedAt: result.archivedAt } : plan)),
    );
  }

  async function handleArchive(id: string) {
    setConfirmArchiveId(null);
    const result = await onArchive(id);
    applyArchiveResult(id, result);
  }

  async function handleUnarchive(id: string) {
    const result = await onUnarchive(id);
    applyArchiveResult(id, result);
  }

  function renderPlanCard(plan: WorkoutPlanSummary, options: { archived: boolean }) {
    const isCurrent = !options.archived && plan.id === currentPlanId;
    const band = ageBand(plan.lastTrainedAt, now);
    const testId = options.archived ? `plan-card-archived-${plan.id}` : `plan-card-${plan.id}`;

    return (
      <div
        key={testId}
        data-testid={testId}
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

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
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

          {options.archived ? (
            <button
              type="button"
              className="kin-btn kin-btn--ghost"
              data-testid={`plan-unarchive-${plan.id}`}
              onClick={() => void handleUnarchive(plan.id)}
            >
              {t("plans.archive.unarchiveAction")}
            </button>
          ) : (
            <button
              type="button"
              className="kin-btn kin-btn--ghost"
              data-testid={`plan-archive-${plan.id}`}
              onClick={() => setConfirmArchiveId(plan.id)}
            >
              {t("plans.archive.action")}
            </button>
          )}
        </div>

        {confirmArchiveId === plan.id && (
          <section
            role="alertdialog"
            aria-label={t("plans.archive.confirmTitle")}
            className="kin-card"
            style={{ marginTop: "0.75rem" }}
          >
            <p className="kin-text">{t("plans.archive.confirmBody")}</p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
              <button
                type="button"
                className="kin-btn kin-btn--ghost"
                data-testid={`plan-archive-confirm-${plan.id}`}
                onClick={() => void handleArchive(plan.id)}
              >
                {t("plans.archive.confirm")}
              </button>
              <button
                type="button"
                className="kin-btn kin-btn--accent"
                data-testid={`plan-archive-cancel-${plan.id}`}
                onClick={() => setConfirmArchiveId(null)}
              >
                {t("plans.archive.cancel")}
              </button>
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.grid}>
        {activePlans.map((plan) => renderPlanCard(plan, { archived: false }))}
      </div>

      {archivedPlans.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <button
            type="button"
            className="kin-btn kin-btn--ghost"
            onClick={() => setShowArchived((prev) => !prev)}
          >
            {showArchived
              ? t("plans.archive.hideToggle")
              : t("plans.archive.showToggle", { count: archivedPlans.length })}
          </button>

          {showArchived && (
            <>
              <hr role="separator" style={{ margin: "1rem 0" }} />
              <h2 className="kin-title">{t("plans.archive.sectionHeading")}</h2>
              <div className={styles.grid}>
                {archivedPlans.map((plan) => renderPlanCard(plan, { archived: true }))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default PlanList;
