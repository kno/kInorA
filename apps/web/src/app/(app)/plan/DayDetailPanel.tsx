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
import type { WorkoutSession } from "@kinora/contracts";
import styles from "./plan-week-view.module.css";
import { estimateSessionMinutes } from "./plan-utils";

/** Stable id for the detail panel element — used for aria-controls. */
const DETAIL_PANEL_ID = "day-detail-panel";

export interface DayDetailPanelProps {
  sessions: WorkoutSession[];
  messages: Record<string, string>;
}

export function DayDetailPanel({ sessions, messages }: DayDetailPanelProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const t = (key: string, fallback: string): string => messages[key] ?? fallback;

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
      {/* Day card grid */}
      <div className={styles.dayGrid}>
        {sessions.map((session) => {
          const isActive = session.day === selectedDay;
          const estMin = estimateSessionMinutes(session.exercises);
          const dayLabel = t("plan_day_label", "Day {n}").replace(
            "{n}",
            String(session.day),
          );
          const exercisesLabel = `${session.exercises.length} ${t("plan_exercises_count", "exercises")}`;
          // Known limitation: "1 exercises" is grammatically incorrect.
          // ICU plural ({count, plural, one {exercise} other {exercises}}) would fix
          // this, but the project currently uses a plain key-value i18n catalogue
          // without MessageFormat/ICU support. Left as-is until the catalogue is upgraded.
          const durationLabel = t("plan_est_duration", "est. {n} min").replace(
            "{n}",
            String(estMin),
          );

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
                {t("plan_day_label", "Day {n}").replace(
                  "{n}",
                  String(selectedSession.day),
                )}
              </div>
              <h2 className={styles.detailTitle}>{selectedSession.title}</h2>
              {/* Fix 2: meta line uses catalogue keys, no hardcoded "min" or "·" */}
              <div className={styles.detailMeta}>
                {selectedSession.exercises.length}{" "}
                {t("plan_exercises_count", "exercises")}
                {" · "}
                {t("plan_est_duration", "est. {n} min").replace(
                  "{n}",
                  String(estimateSessionMinutes(selectedSession.exercises)),
                )}
              </div>
            </div>
            <button
              type="button"
              className={styles.detailClose}
              onClick={() => setSelectedDay(null)}
              aria-label={t("plan_day_detail_close", "Close")}
            >
              {t("plan_day_detail_close", "Close")}
            </button>
          </div>

          {/* Exercise table — 4 columns: Exercise · Sets · Reps · Rest (no Peso) */}
          <table className={styles.exTable}>
            <thead>
              <tr>
                <th>{t("plan_table_exercise", "Exercise")}</th>
                <th>{t("plan_table_sets", "Sets")}</th>
                <th>{t("plan_table_reps", "Reps")}</th>
                <th>{t("plan_table_rest", "Rest")}</th>
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
          {/* Empezar sesión CTA — deferred to 09a */}
        </div>
      )}
    </div>
  );
}
