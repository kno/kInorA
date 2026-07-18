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

import { getTranslations } from "next-intl/server";
import type { WorkoutProgram } from "@kinora/contracts";
import styles from "./plan-week-view.module.css";
import { PlanTrackerClient } from "./PlanTrackerClient";
import { estimateSessionMinutes, restDays } from "./plan-utils";
import { getWeeklyOverviewAction } from "./actions";

export interface PlanWeekViewProps {
  program: WorkoutProgram;
  /**
   * Resolved plan label (#93). Rendered as the view header. Already resolved
   * server-side via `defaultPlanName`, so it is displayed verbatim with no
   * client-side fallback. Absent only for legacy callers.
   */
  planName?: string;
  /**
   * Plan id (#93 Slice 3). Threaded into `PlanTrackerClient` so the per-day
   * Start CTA can call `startWorkoutSessionAction(planId, day)` inline.
   */
  planId: string;
  /**
   * Requested displayed week (ISO `YYYY-MM-DD` Monday), from the `?weekStart=`
   * search param (09c-v1-progress-dashboard-stats, Slice 4b). `undefined`
   * defaults to the current week.
   */
  weekStart?: string;
}

export async function PlanWeekView({ program, planName, planId, weekStart }: PlanWeekViewProps) {
  const t = await getTranslations();

  // Fail-open: an unreachable/erroring overview fetch leaves `weeklyOverview`
  // undefined, and `DayDetailPanel` falls back to its Slice-4a rendering
  // (inert nav, no per-day state) rather than breaking the whole page.
  const overviewResult = await getWeeklyOverviewAction(weekStart);
  const weeklyOverview = overviewResult.kind === "ok" ? overviewResult.overview : undefined;

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
    <PlanTrackerClient
      program={program}
      planId={planId}
      planName={planName}
      weeklyOverview={weeklyOverview}
    >
      {/* Plan name header (#93) — server-resolved label, rendered verbatim. */}
      {planName && <h1 className={styles.planName}>{planName}</h1>}

      {/* 4-tile summary strip */}
      <div className={styles.summaryStrip}>
        {/* Sesiones planificadas */}
        <div className={styles.summaryItem}>
          <div className={styles.summaryEyebrow}>{t("plan.summary.sessions")}</div>
          <div className={styles.summaryVal}>{sessionCount}</div>
          <div className={styles.summarySub}>{t("plan.summary.sessionsSub")}</div>
        </div>

        {/* Días de descanso — derived, no API change */}
        <div className={styles.summaryItem}>
          <div className={styles.summaryEyebrow}>{t("plan.summary.rest")}</div>
          <div className={styles.summaryVal}>{restDayCount}</div>
          <div className={styles.summarySub}>{t("plan.summary.restSub")}</div>
        </div>

        {/* Duración estimada — best-effort derivation with overhead constant */}
        <div className={styles.summaryItem}>
          <div className={styles.summaryEyebrow}>{t("plan.summary.duration")}</div>
          <div className={styles.summaryVal}>{totalDurationMin}</div>
          <div className={styles.summarySub}>{t("plan.summary.durationSub")}</div>
        </div>

        {/* Volumen objetivo — inert placeholder, deferred to 09a */}
        <div className={styles.summaryItem}>
          <div className={styles.summaryEyebrow}>{t("plan.summary.volume")}</div>
          <div className={styles.summaryVal}>{t("plan.summary.volumePlaceholder")}</div>
          <div className={styles.summarySub}>{t("plan.summary.volumeSub")}</div>
        </div>
      </div>

      {/* Limitation warning banner — shown above grid when warnings present */}
      {hasWarnings && (
        <div className={styles.limitationBanner} role="alert">
          <div className={styles.limitationBannerTitle}>
            {t("plan.limitation.title")}
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

      {/* Day-card grid + detail panel + per-day Start CTA are rendered by
          PlanTrackerClient (the surrounding client wrapper), which owns the
          inline session/conflict state-swap (#93 Slice 3). */}
    </PlanTrackerClient>
  );
}
