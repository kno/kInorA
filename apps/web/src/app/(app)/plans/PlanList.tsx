"use client";

/**
 * PlanList — presentational client component for the `/plans` surface
 * (17d PR A, archive PR B). Renders every plan with its progress fields, the
 * currently-followed plan as a two-column primary object with a badge, and —
 * for `generating`/`failed` plans — the SAME status copy `/plan` already shows,
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

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Decorative mark for the currently-followed plan's media column. */
function PlanMark() {
  return (
    <svg className={styles.mediaMark} viewBox="0 0 48 24" fill="none" aria-hidden="true">
      <path
        d="M4 8v8M10 5v14M38 5v14M44 8v8M10 12h28"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface ArchiveConfirmDialogProps {
  planId: string;
  /** The control that opened the dialog; focus returns here on close. */
  triggerRef: React.RefObject<HTMLElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The archive confirmation, as a real modal.
 *
 * It carried `role="alertdialog"` while providing none of the behaviour that
 * role promises (issue #412): no `aria-modal`, no focus trap, no
 * Escape-to-dismiss, no focus restore. A keyboard reader could Tab straight
 * out of a dialog asking them to confirm a destructive-looking action and
 * operate the page behind it. All four are implemented here, and the focus
 * contract is covered by tests so it cannot regress silently.
 */
function ArchiveConfirmDialog({
  planId,
  triggerRef,
  onConfirm,
  onCancel,
}: ArchiveConfirmDialogProps) {
  const t = useTranslations();
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    focusableElements(dialogRef.current)[0]?.focus();
    const trigger = triggerRef.current;
    return () => {
      // The trigger may have unmounted with the plan it belongs to (confirming
      // archive moves the row out of the active grid), so this is best-effort.
      if (trigger?.isConnected) trigger.focus();
    };
  }, [triggerRef]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusableElements(dialogRef.current);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.overlay} onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={t("plans.archive.confirmTitle")}
        className={`kin-card ${styles.dialog}`}
      >
        <p className="kin-text">{t("plans.archive.confirmBody")}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className="kin-btn kin-btn--ghost"
            data-testid={`plan-archive-confirm-${planId}`}
            onClick={onConfirm}
          >
            {t("plans.archive.confirm")}
          </button>
          <button
            type="button"
            className="kin-btn kin-btn--accent"
            data-testid={`plan-archive-cancel-${planId}`}
            onClick={onCancel}
          >
            {t("plans.archive.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
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
  const archiveTriggerRef = React.useRef<HTMLElement | null>(null);

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
      <article
        key={testId}
        data-testid={testId}
        className={`kin-card ${styles.card} ${isCurrent ? styles.currentPlan : ""}`}
      >
        {/* The currently-followed plan is a two-column object, not merely a
            wider row: a media column plus the body, so it reads as the primary
            thing on the page at a glance. Decorative only — `aria-hidden`. */}
        {isCurrent && (
          <div className={styles.media} aria-hidden="true">
            <PlanMark />
          </div>
        )}

        <div className={styles.body}>
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

          <div className={styles.actions}>
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

            {/* 17d PR D: editing is a ready-plan action, and it is deliberately
                absent on an archived row — the server allows the edit, but a
                plan you have put away is not one you are shaping. Absent, not
                disabled: unlike Open, there is nothing to explain here. */}
            {plan.status === "ready" && !options.archived && (
              <a
                href={`/plan/${plan.id}/edit`}
                className="kin-btn kin-btn--ghost"
                data-testid={`plan-edit-${plan.id}`}
              >
                {t("planEdit.openAction")}
              </a>
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
                onClick={(event) => {
                  archiveTriggerRef.current = event.currentTarget;
                  setConfirmArchiveId(plan.id);
                }}
              >
                {t("plans.archive.action")}
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div>
      <div className={styles.grid}>
        {activePlans.map((plan) => renderPlanCard(plan, { archived: false }))}
      </div>

      {archivedPlans.length > 0 && (
        <div className={styles.archivedSection}>
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
              <hr role="separator" className={styles.separator} />
              <h2 className="kin-title">{t("plans.archive.sectionHeading")}</h2>
              <div className={styles.grid}>
                {archivedPlans.map((plan) => renderPlanCard(plan, { archived: true }))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Rendered once at the root rather than inside the row it belongs to: a
          modal overlays the page, it is not a box nested in a card. */}
      {confirmArchiveId !== null && (
        <ArchiveConfirmDialog
          planId={confirmArchiveId}
          triggerRef={archiveTriggerRef}
          onConfirm={() => void handleArchive(confirmArchiveId)}
          onCancel={() => setConfirmArchiveId(null)}
        />
      )}
    </div>
  );
}

export default PlanList;
