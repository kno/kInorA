"use client";

/**
 * DayDetailPanel — client island.
 *
 * Renders a responsive day-card grid plus an expandable detail panel
 * for the selected session. All data is received as props; this component
 * NEVER calls fetch, API_BASE_URL, or any server action — it manages only
 * local UI state (selectedDay: number | null).
 *
 * Deferred to 09a: weight column, completion check-marks, "today" highlighting,
 * "Empezar sesión" CTA, week navigation.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { WorkoutSession } from "@kinora/contracts";
import styles from "./plan-week-view.module.css";
import { estimateSessionMinutes } from "./plan-utils";

/** Stable id for the detail panel element — used for aria-controls. */
const DETAIL_PANEL_ID = "day-detail-panel";

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
}

export function DayDetailPanel({
  sessions,
  onStartWorkout,
  conflict,
}: DayDetailPanelProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const t = useTranslations();

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

  return (
    <div>
      {/* Active-session conflict banner (#93 Slice 3) — localized, names the
          plan/day the user must resume or finish before starting another. */}
      {conflict && (
        <div className={styles.conflictBanner} role="alert" data-testid="start-conflict">
          {conflictText}
        </div>
      )}

      {/* Day card grid */}
      <div className={styles.dayGrid}>
        {sessions.map((session) => {
          const isActive = session.day === selectedDay;
          const estMin = estimateSessionMinutes(session.exercises);
          const dayLabel = t("plan.day.label", { n: session.day });
          const exercisesLabel = `${session.exercises.length} ${t("plan.exercises.count")}`;
          const durationLabel = t("plan.est_duration", { n: estMin });

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
              <div className={styles.dcDayLabel}>{dayLabel}</div>
              <div className={styles.dcFocus}>{session.title}</div>
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
