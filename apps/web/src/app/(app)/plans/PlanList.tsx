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
 *
 * ## Bulk archive (#412)
 *
 * Selecting several plans and archiving them in one action. Five decisions
 * worth stating, because each had a defensible alternative:
 *
 * - **It reuses `ConfirmDialog`, the modal the archive confirmation already
 *   became.** Bulk asks the same question about N plans and needs the same
 *   focus contract, so the dialog was generalised rather than cloned — two
 *   confirmation mechanisms on one screen would be worse than the inline block
 *   the modal replaced.
 * - **It loops client-side over the existing one-plan endpoint** rather than
 *   gaining a batch route. `POST /workout-plans/:id/archive` is already
 *   idempotent (`COALESCE(archived_at, now())`), already tenant+user scoped,
 *   and already returns the row's `archivedAt`. A batch route would have to
 *   re-derive that authorization and then invent a partial-result protocol on
 *   the wire — which the loop gets for free, one result per plan. It also
 *   adds no new server surface that "bulk" could later be pointed at a DELETE,
 *   and a delete is the one thing this feature must never become:
 *   `workout_sessions` cascades from a plan, and sessions cascade to exercises
 *   and set records.
 * - **Partial failure is reported by name.** Three of five succeeding is the
 *   normal outcome of a loop over a flaky network, and a generic "something
 *   went wrong" would leave the user unable to tell which two to retry. The
 *   ones that failed stay selected, so retrying is one click.
 * - **Selection covers active rows only, and the show-archived toggle does not
 *   clear it.** The archived section has no checkboxes, so flipping the toggle
 *   neither adds nor removes anything selectable; clearing the selection would
 *   be a surprise, not a safeguard. Unarchive stays a single-row action —
 *   restoring is a recovery, not a workflow, and nothing about it is tedious
 *   enough to batch.
 * - **The plan you are currently following can be selected**, exactly as a
 *   single-row archive allows today. Silently skipping it would archive fewer
 *   plans than the user asked for and say nothing.
 */
import * as React from "react";
import { useTranslations, useFormatter } from "next-intl";
import type { WorkoutPlanSummary } from "@kinora/contracts";
import { defaultPlanName } from "@kinora/domain/plan";
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

/**
 * The label to name a plan by in a checkbox or a bulk report.
 *
 * `name` is optional on the DTO even though the API always sends one — every
 * plan read passes through the single blank→default layer in `plan-route-repo`.
 * This is NOT a second rule: it is the very same `defaultPlanName` that layer
 * calls, so the impossible case cannot produce a label that disagrees with the
 * one the rest of the app shows — and no control ends up with a blank
 * accessible name.
 */
function planLabel(plan: WorkoutPlanSummary): string {
  return plan.name ?? defaultPlanName(plan.name, plan.createdAt);
}

/**
 * Outcome of a bulk archive (#412). `partial` is the state this type exists
 * for: it carries the plans that WERE archived as well as the ones that were
 * not, because "some of this worked" is the answer the user needs and a
 * single boolean cannot give it. `done` is the all-succeeded case, reported
 * separately so a clean run is not dressed up as a warning.
 */
type BulkState =
  | { kind: "idle" }
  | { kind: "archiving" }
  | { kind: "done"; archived: readonly string[] }
  | { kind: "partial"; archived: readonly string[]; failed: readonly string[] };

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

interface ConfirmDialogProps {
  /** Accessible name — the question being asked. */
  label: string;
  /** The reassurance body. Always states that nothing is deleted. */
  body: string;
  confirmTestId: string;
  cancelTestId: string;
  /** Optional test hook on the dialog itself, for the bulk variant. */
  dialogTestId?: string;
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
 *
 * #412 (bulk half) generalised this from an archive-one dialog to a confirm
 * dialog: the copy, the two test hooks and the accessible name are props now.
 * Bulk archive asks the same question about N plans and needs the same focus
 * contract, and TWO dialog mechanisms on one screen would be worse than the
 * inline block this replaced. Everything below the props — the trap, the
 * restore, the Escape handling — is unchanged and shared by both callers.
 */
function ConfirmDialog({
  label,
  body,
  confirmTestId,
  cancelTestId,
  dialogTestId,
  triggerRef,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
        aria-label={label}
        data-testid={dialogTestId}
        className={`kin-card ${styles.dialog}`}
      >
        <p className="kin-text">{body}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className="kin-btn kin-btn--ghost"
            data-testid={confirmTestId}
            onClick={onConfirm}
          >
            {t("plans.archive.confirm")}
          </button>
          <button
            type="button"
            className="kin-btn kin-btn--accent"
            data-testid={cancelTestId}
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
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([]);
  const [confirmBulk, setConfirmBulk] = React.useState(false);
  const [bulkState, setBulkState] = React.useState<BulkState>({ kind: "idle" });
  // Its own trigger ref: focus must return to the bulk Archive button, not to
  // whichever row's Archive was pressed last.
  const bulkTriggerRef = React.useRef<HTMLElement | null>(null);

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
    // A plan archived on its own leaves the selection with it (#412): the
    // count must never include a row that is no longer in the active grid.
    if (result) {
      setSelectedIds((prev) => prev.filter((selected) => selected !== id));
    }
  }

  async function handleUnarchive(id: string) {
    const result = await onUnarchive(id);
    applyArchiveResult(id, result);
  }

  function toggleSelected(id: string) {
    setBulkState({ kind: "idle" });
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((selected) => selected !== id) : [...prev, id],
    );
  }

  /**
   * Archive every selected plan, one call each, and report which ones landed.
   *
   * The calls go out in parallel but the OUTCOMES are collected per plan, so a
   * failure in the middle neither aborts the rest nor gets rolled up into a
   * single "it failed". `onArchive` resolves to `null` on any failure — that is
   * the Server Action's existing contract, and it is all this needs: which
   * plan, and did it land.
   *
   * Selection is narrowed to plans that are still active at the moment the
   * user confirms, so a row archived individually while the dialog was open
   * cannot be counted as a bulk failure.
   */
  async function handleBulkArchive() {
    const targets = activePlans.filter((plan) => selectedIds.includes(plan.id));
    setConfirmBulk(false);
    setBulkState({ kind: "archiving" });

    const outcomes = await Promise.all(
      targets.map(async (plan) => ({
        plan,
        result: await onArchive(plan.id).catch(() => null),
      })),
    );

    for (const { plan, result } of outcomes) {
      applyArchiveResult(plan.id, result);
    }

    const archived = outcomes.filter(({ result }) => result !== null).map(({ plan }) => plan);
    const failed = outcomes.filter(({ result }) => result === null).map(({ plan }) => plan);

    // The ones that did not land stay selected: retrying is then one click,
    // and the selection matches what the message says is still outstanding.
    setSelectedIds(failed.map((plan) => plan.id));
    setBulkState(
      failed.length === 0
        ? { kind: "done", archived: archived.map(planLabel) }
        : {
            kind: "partial",
            archived: archived.map(planLabel),
            failed: failed.map(planLabel),
          },
    );
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
          {/* #412: selection is offered on active rows only — the archived
              section has nothing to bulk-archive. Labelled with the plan's own
              name, because "checkbox" tells a screen-reader user which control
              they are on but not which plan. */}
          {!options.archived && (
            <input
              type="checkbox"
              className={styles.select}
              data-testid={`plan-select-${plan.id}`}
              aria-label={t("plans.archive.bulk.selectLabel", { name: planLabel(plan) })}
              checked={selectedIds.includes(plan.id)}
              onChange={() => toggleSelected(plan.id)}
            />
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
      {/* #412 — the bulk bar appears only once something is selected, so an
          untouched list looks exactly as it did. */}
      {selectedIds.length > 0 && (
        <div className={styles.bulkBar} data-testid="plan-bulk-bar">
          <span className="kin-text" data-testid="plan-bulk-count">
            {t("plans.archive.bulk.selectedCount", { count: selectedIds.length })}
          </span>
          <button
            type="button"
            className="kin-btn kin-btn--ghost"
            data-testid="plan-bulk-archive"
            disabled={bulkState.kind === "archiving"}
            onClick={(event) => {
              bulkTriggerRef.current = event.currentTarget;
              setConfirmBulk(true);
            }}
          >
            {t("plans.archive.bulk.action")}
          </button>
          <button
            type="button"
            className="kin-btn kin-btn--ghost"
            data-testid="plan-bulk-clear"
            onClick={() => {
              setSelectedIds([]);
              setConfirmBulk(false);
              setBulkState({ kind: "idle" });
            }}
          >
            {t("plans.archive.bulk.clear")}
          </button>
        </div>
      )}

      {bulkState.kind === "done" && (
        <p className="kin-text" role="status" data-testid="plan-bulk-done">
          {t("plans.archive.bulk.successBody", { count: bulkState.archived.length })}
        </p>
      )}

      {/* A partial success is the failure mode worth designing for: naming only
          the total would leave the user unable to tell which plans to retry. */}
      {bulkState.kind === "partial" && (
        <div role="alert" className="kin-card kin-card--warning" data-testid="plan-bulk-partial">
          <p className="kin-error">{t("plans.archive.bulk.resultTitle")}</p>
          {bulkState.archived.length > 0 && (
            <p className="kin-text" data-testid="plan-bulk-partial-archived">
              {t("plans.archive.bulk.resultArchived", {
                names: bulkState.archived.join(", "),
              })}
            </p>
          )}
          <p className="kin-text" data-testid="plan-bulk-partial-failed">
            {t("plans.archive.bulk.resultFailed", { names: bulkState.failed.join(", ") })}
          </p>
        </div>
      )}

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
        <ConfirmDialog
          label={t("plans.archive.confirmTitle")}
          body={t("plans.archive.confirmBody")}
          confirmTestId={`plan-archive-confirm-${confirmArchiveId}`}
          cancelTestId={`plan-archive-cancel-${confirmArchiveId}`}
          triggerRef={archiveTriggerRef}
          onConfirm={() => void handleArchive(confirmArchiveId)}
          onCancel={() => setConfirmArchiveId(null)}
        />
      )}

      {/* #412 — the SAME modal, asking the same question about N plans, with
          its own pluralised copy. The "nothing is deleted" guarantee is in
          both plural branches of `bulk.confirmBody`. */}
      {confirmBulk && selectedIds.length > 0 && (
        <ConfirmDialog
          label={t("plans.archive.bulk.confirmTitle", { count: selectedIds.length })}
          body={t("plans.archive.bulk.confirmBody", { count: selectedIds.length })}
          confirmTestId="plan-bulk-confirm-yes"
          cancelTestId="plan-bulk-confirm-cancel"
          dialogTestId="plan-bulk-confirm"
          triggerRef={bulkTriggerRef}
          onConfirm={() => void handleBulkArchive()}
          onCancel={() => setConfirmBulk(false)}
        />
      )}
    </div>
  );
}

export default PlanList;
