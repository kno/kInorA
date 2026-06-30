/**
 * PlanWeekView — server component.
 *
 * Renders the plan "ready" state: a 4-tile summary strip, an optional
 * limitation warning banner, and the DayDetailPanel client island.
 *
 * All data is derived from the WorkoutProgram prop — no API calls.
 * No "use client" directive: this is a pure server component.
 *
 * Deferred to 09a:
 *   - Volumen objetivo real value (tile shows "—" placeholder)
 *   - Completion check-marks and "today" highlighting (need execution tracking)
 *   - "Empezar sesión" CTA (in DayDetailPanel)
 *   - Week navigation prev/next buttons
 */

import type { WorkoutProgram, WorkoutSession } from "@kinora/contracts";
import styles from "./plan-week-view.module.css";
import { DayDetailPanel } from "./DayDetailPanel";

/** Assumed average seconds to perform one set (rep execution). Documented estimate. */
export const EXECUTION_OVERHEAD_SECONDS = 30;

/**
 * Estimate session duration in minutes.
 * Formula: ceil( Σ(sets × (restSeconds + EXECUTION_OVERHEAD_SECONDS)) / 60 )
 */
export function estimateSessionMinutes(
  exercises: WorkoutSession["exercises"],
): number {
  const totalSeconds = exercises.reduce(
    (sum, e) => sum + e.sets * (e.restSeconds + EXECUTION_OVERHEAD_SECONDS),
    0,
  );
  return Math.ceil(totalSeconds / 60);
}

/**
 * Derive rest days from 08 contract invariant:
 *   weeklySessions.length === daysPerWeek → rest days = max(0, 7 − length)
 * No API change required.
 */
export function restDays(weeklySessions: WorkoutSession[]): number {
  return Math.max(0, 7 - weeklySessions.length);
}

export interface PlanWeekViewProps {
  program: WorkoutProgram;
  messages: Record<string, string>;
}

export function PlanWeekView({ program, messages }: PlanWeekViewProps) {
  const t = (key: string, fallback: string): string => messages[key] ?? fallback;

  const sessions = program.weeklySessions;
  const sessionCount = sessions.length;
  const restDayCount = restDays(sessions);
  const totalDurationMin = sessions.reduce(
    (sum, s) => sum + estimateSessionMinutes(s.exercises),
    0,
  );
  const hasWarnings =
    Array.isArray(program.limitationWarnings) &&
    program.limitationWarnings.length > 0;

  return (
    <div>
      {/* 4-tile summary strip */}
      <div className={styles.summaryStrip}>
        {/* Sesiones planificadas */}
        <div className={styles.summaryItem}>
          <div className={styles.summaryEyebrow}>
            {t("plan_summary_sessions", "Planned sessions")}
          </div>
          <div className={styles.summaryVal}>{sessionCount}</div>
          <div className={styles.summarySub}>
            {t("plan_summary_sessions_sub", "training days")}
          </div>
        </div>

        {/* Días de descanso — derived, no API change */}
        <div className={styles.summaryItem}>
          <div className={styles.summaryEyebrow}>
            {t("plan_summary_rest", "Rest days")}
          </div>
          <div className={styles.summaryVal}>{restDayCount}</div>
          <div className={styles.summarySub}>
            {t("plan_summary_rest_sub", "per week")}
          </div>
        </div>

        {/* Duración estimada — best-effort derivation with overhead constant */}
        <div className={styles.summaryItem}>
          <div className={styles.summaryEyebrow}>
            {t("plan_summary_duration", "Estimated duration")}
          </div>
          <div className={styles.summaryVal}>{totalDurationMin}</div>
          <div className={styles.summarySub}>
            {t("plan_summary_duration_sub", "per week (est.)")}
          </div>
        </div>

        {/* Volumen objetivo — inert placeholder, deferred to 09a */}
        <div className={styles.summaryItem}>
          <div className={styles.summaryEyebrow}>
            {t("plan_summary_volume", "Target volume")}
          </div>
          <div className={styles.summaryVal}>
            {t("plan_summary_volume_placeholder", "—")}
          </div>
          <div className={styles.summarySub}>
            {t("plan_summary_volume_sub", "coming soon")}
          </div>
        </div>
      </div>

      {/* Limitation warning banner — shown above grid when warnings present */}
      {hasWarnings && (
        <div className={styles.limitationBanner} role="alert">
          <div className={styles.limitationBannerTitle}>
            {t("plan_limitation_title", "Important note")}
          </div>
          <ul className={styles.limitationBannerList}>
            {program.limitationWarnings.map((warning, idx) => (
              <li key={idx} className={styles.limitationBannerItem}>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Day-card grid + detail panel (client island) */}
      <DayDetailPanel sessions={sessions} messages={messages} />
    </div>
  );
}
