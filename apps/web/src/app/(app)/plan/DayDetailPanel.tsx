"use client";

/**
 * DayDetailPanel — client island.
 *
 * Renders a week-board header, a responsive day-card grid, and an expandable
 * detail panel for the selected session. Data is received as props; the only
 * server call this component makes is `getWeeklyOverviewAction` (a Server
 * Action), and only when `weeklyOverview` is provided and the user clicks
 * prev/next — it never calls `fetch` or `API_BASE_URL` directly.
 *
 * Visual anatomy realigned to `screens/web-plan.html`'s week board (Slice 4a,
 * 09c-v1-progress-dashboard-stats — closes #128). Slice 4b wires the real
 * data on top of that layout: when `weeklyOverview` is provided, the 7-day
 * Monday–Sunday board renders with real done/active/rest/soon day states and
 * functional prev/next navigation (via the Server Action, no page reload).
 * When `weeklyOverview` is absent (legacy `/plan/[id]` callers), the board
 * falls back to the Slice-4a inert/session-only rendering unchanged.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { WeeklyDayStatus, WeeklyOverviewDTO, WorkoutSession } from "@kinora/contracts";
import styles from "./plan-week-view.module.css";
import { estimateSessionMinutes, sessionLoadBars } from "./plan-utils";
import { getWeeklyOverviewAction } from "./actions";

/** Stable id for the detail panel element — used for aria-controls. */
const DETAIL_PANEL_ID = "day-detail-panel";

/** Status glyph per `WeeklyDayStatus` (design.md "The week model"). */
const STATE_GLYPHS: Record<WeeklyDayStatus, string> = {
  done: "✓",
  active: "▶",
  rest: "–",
  soon: "•",
};

export interface DayDetailPanelProps {
  sessions: WorkoutSession[];
  /**
   * Per-day start handler (#93 Slice 3). When provided, each open day panel
   * shows a "Start session" CTA that calls this with the day number. When
   * absent, the panel stays purely presentational — the legacy `/plan/[id]`
   * flow (PlanStatusClient) renders its own start buttons and never passes it.
   */
  onStartWorkout?: (day: number) => void;
  /**
   * Active-session conflict scope (#93 Slice 3). Set when a start attempt
   * returns a 409 `active_session_conflict`. Renders a localized banner naming
   * the plan/day the user must resume or finish first. The single-active
   * invariant is enforced server-side; this only surfaces it.
   */
  conflict?: { activePlanName?: string; activeDay: number | null };
  /**
   * Real weekly-progress overlay (09c-v1-progress-dashboard-stats, Slice
   * 4b) — the current calendar week's day states + prev/next week bounds,
   * server-fetched via `getWeeklyOverviewAction`. When absent, the board
   * falls back to the Slice-4a session-only rendering (inert nav, no
   * per-day state distinction) for backward compatibility.
   */
  weeklyOverview?: WeeklyOverviewDTO;
}

export function DayDetailPanel({
  sessions,
  onStartWorkout,
  conflict,
  weeklyOverview,
}: DayDetailPanelProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [overview, setOverview] = useState(weeklyOverview);

  const t = useTranslations();

  async function navigateWeek(targetWeekStart: string): Promise<void> {
    const result = await getWeeklyOverviewAction(targetWeekStart);
    if (result.kind === "ok") {
      setOverview(result.overview);
    }
  }

  // Derived localized conflict message (readability: no per-render fn, no
  // side effects). Empty string when there is no conflict.
  const conflictText = ((): string => {
    if (!conflict) return "";
    if (!conflict.activePlanName) {
      return t("plan.start.conflict_generic");
    }
    if (conflict.activeDay == null) {
      return t("plan.start.conflict_no_day", { plan: conflict.activePlanName });
    }
    return t("plan.start.conflict", { plan: conflict.activePlanName, n: conflict.activeDay });
  })();

  function handleCardClick(day: number): void {
    setSelectedDay((prev) => (prev === day ? null : day));
  }

  function handleKeyDown(e: React.KeyboardEvent, day: number): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick(day);
    }
  }

  const selectedSession = sessions.find((s) => s.day === selectedDay) ?? null;

  // Monday-first status per plan-day index (design.md "Planned-day →
  // weekday mapping"). `undefined` (no `weeklyOverview`) preserves the
  // Slice-4a fallback: every glyph renders identically, matching the
  // existing session-only tests unchanged.
  const statusByDay = new Map<number, WeeklyDayStatus>();
  if (overview) {
    overview.days.forEach((day, index) => statusByDay.set(index + 1, day.status));
  }

  return (
    <div>
      {/* Active-session conflict banner (#93 Slice 3) — localized, names the
          plan/day the user must resume or finish before starting another. */}
      {conflict && (
        <div className={styles.conflictBanner} role="alert" data-testid="start-conflict">
          {conflictText}
        </div>
      )}

      {/* Week board header — eyebrow/title + week-nav. Functional (Slice 4b)
          when `overview` is present: the label reflects the real displayed
          week and prev/next call the Server Action to fetch the adjacent
          week — no page reload. Falls back to the Slice-4a inert/static
          rendering when there is no overview (legacy callers). */}
      <div className={styles.boardHead}>
        <div>
          <div className={styles.boardEyebrow}>{t("plan.week.eyebrow")}</div>
          <h2 className={styles.boardTitle}>{t("plan.week.title")}</h2>
        </div>
        <div className={styles.weekNav} aria-label={t("plan.week.navLabel")}>
          <button
            type="button"
            className={styles.weekNavBtn}
            disabled={!overview}
            aria-label={t("plan.week.prev")}
            onClick={overview ? () => void navigateWeek(overview.previousWeekStart) : undefined}
          >
            ‹
          </button>
          <span className={styles.weekLabel}>{overview ? overview.weekLabel : t("plan.week.label")}</span>
          <button
            type="button"
            className={styles.weekNavBtn}
            disabled={!overview}
            aria-label={t("plan.week.next")}
            onClick={overview ? () => void navigateWeek(overview.nextWeekStart) : undefined}
          >
            ›
          </button>
        </div>
      </div>

      {/* Day card grid */}
      <div className={styles.dayGrid}>
        {sessions.map((session) => {
          const isActive = session.day === selectedDay;
          const estMin = estimateSessionMinutes(session.exercises);
          const dayLabel = t("plan.day.label", { n: session.day });
          const exercisesLabel = `${session.exercises.length} ${t("plan.exercises.count")}`;
          const durationLabel = t("plan.est_duration", { n: estMin });
          const loadBars = sessionLoadBars(session.exercises);
          const status = statusByDay.get(session.day);
          const glyph = status ? STATE_GLYPHS[status] : "•";
          const stateLabel = status ? t(`plan.dayState.${status}`) : undefined;

          return (
            <div
              key={session.day}
              role="button"
              tabIndex={0}
              aria-expanded={isActive}
              aria-label={dayLabel}
              aria-controls={isActive ? DETAIL_PANEL_ID : undefined}
              className={`${styles.dayCard}${isActive ? ` ${styles.dayCardActive}` : ""}`}
              onClick={() => handleCardClick(session.day)}
              onKeyDown={(e) => handleKeyDown(e, session.day)}
            >
              <div className={styles.dayTop}>
                <div className={styles.dcDayLabel}>{dayLabel}</div>
                {/* Status glyph slot. Real done/active/rest/soon state
                    (Slice 4b) when `weeklyOverview` is provided; otherwise
                    every card renders the same neutral glyph (Slice 4a). */}
                <div
                  className={styles.dcStateGlyph}
                  data-testid="day-card-state"
                  aria-label={stateLabel}
                  aria-hidden={stateLabel ? undefined : "true"}
                >
                  {glyph}
                </div>
              </div>
              <div className={styles.dcFocus}>{session.title}</div>
              <div
                className={styles.dcMiniStack}
                data-testid="day-card-bars"
                aria-hidden="true"
              >
                {loadBars.map((height, idx) => (
                  <span
                    key={idx}
                    className={styles.dcBar}
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
              <div className={styles.dcMeta}>
                {exercisesLabel} · {durationLabel}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail panel — shown when a day is selected */}
      {selectedSession !== null && (
        <div id={DETAIL_PANEL_ID} className={styles.detailPanel}>
          <div className={styles.detailHeader}>
            <div className={styles.detailTitleBlock}>
              <div className={styles.detailEyebrow}>
                {t("plan.day.label", { n: selectedSession.day })}
              </div>
              <h2 className={styles.detailTitle}>{selectedSession.title}</h2>
              {/* Fix 2: meta line uses catalogue keys, no hardcoded "min" or "·" */}
              <div className={styles.detailMeta}>
                {selectedSession.exercises.length}{" "}
                {t("plan.exercises.count")}
                {" · "}
                {t("plan.est_duration", {
                  n: estimateSessionMinutes(selectedSession.exercises),
                })}
              </div>
            </div>
            <button
              type="button"
              className={styles.detailClose}
              onClick={() => setSelectedDay(null)}
              aria-label={t("plan.day.detailClose")}
            >
              {t("plan.day.detailClose")}
            </button>
          </div>

          {/* Exercise table — 4 columns: Exercise · Sets · Reps · Rest (no Peso) */}
          <table className={styles.exTable}>
            <thead>
              <tr>
                <th>{t("plan.table.exercise")}</th>
                <th>{t("plan.table.sets")}</th>
                <th>{t("plan.table.reps")}</th>
                <th>{t("plan.table.rest")}</th>
              </tr>
            </thead>
            <tbody>
              {selectedSession.exercises.map((exercise, idx) => (
                <tr key={`${selectedSession.day}-${idx}`}>
                  <td>
                    <div className={styles.exerciseName}>
                      <span>{exercise.name}</span>
                      {exercise.notes && (
                        <span className={styles.exerciseNote}>{exercise.notes}</span>
                      )}
                      {exercise.substitutionNote && (
                        <span className={styles.exerciseSubstitution}>
                          {exercise.substitutionNote}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{exercise.sets}</td>
                  <td>{exercise.reps}</td>
                  <td>
                    <span className={styles.restChip}>
                      {/* Clock icon */}
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                      {exercise.restSeconds} s
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Per-day Start CTA (#93 Slice 3). Only rendered when a start
              handler is provided (the `/plan` inline flow). On `/plan` the
              page renders this panel only for a `ready` plan, so the plan is
              startable by construction. */}
          {onStartWorkout && (
            <button
              type="button"
              className="kin-btn kin-btn--primary"
              onClick={() => onStartWorkout(selectedSession.day)}
            >
              {t("plan.day.startCta")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
