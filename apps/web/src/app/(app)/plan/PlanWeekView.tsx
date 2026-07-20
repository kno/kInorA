/**
 * PlanWeekView — server component.
 *
 * Renders the plan "ready" state as the cockpit layout from
 * `screens/web-plan.html`: a topbar (plan name + lead + actions), a two-column
 * cockpit whose main column holds the hero (session copy + DATA-WIRED metrics
 * + muscle body-map) and the week board, and a presentational side rail
 * (readiness ring, today's blocks, Coach AI).
 *
 * DATA-WIRED (derived from the WorkoutProgram / WeeklyOverviewDTO props):
 *   - the 4 metric tiles (sessions / rest / est. duration / volume placeholder)
 *   - the limitation-warning banner
 *   - the 7-tile Mon–Sun board with real day states + week navigation
 *     (rendered by PlanTrackerClient → DayDetailPanel)
 *
 * PRESENTATIONAL ONLY (no data model yet — see plan-presentational.tsx):
 *   - the topbar actions, the hero session copy + body-map, and the side rail.
 *
 * No "use client" directive: this is a pure server component. The only server
 * call is `getWeeklyOverviewAction` (a Server Action); the browser never sees
 * API_BASE_URL.
 */

import { getTranslations } from "next-intl/server";
import type { WorkoutProgram } from "@kinora/contracts";
import styles from "./plan-week-view.module.css";
import { PlanTrackerClient } from "./PlanTrackerClient";
import { PlanHero, PlanSideRail, PlanToolbar } from "./plan-presentational";
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

  // DATA-WIRED metrics grid — kept as literal server JSX so the values stay
  // server-derived. Passed into the (presentational) hero panel via children.
  const metrics = (
    <div className={styles.metrics} aria-label={t("plan.hero.focusLabel")}>
      <div className={styles.metric}>
        <div className={styles.metricEyebrow}>{t("plan.summary.sessions")}</div>
        <div className={styles.metricValue}>{sessionCount}</div>
        <div className={styles.metricSub}>{t("plan.summary.sessionsSub")}</div>
      </div>
      <div className={styles.metric}>
        <div className={styles.metricEyebrow}>{t("plan.summary.rest")}</div>
        <div className={styles.metricValue}>{restDayCount}</div>
        <div className={styles.metricSub}>{t("plan.summary.restSub")}</div>
      </div>
      <div className={styles.metric}>
        <div className={styles.metricEyebrow}>{t("plan.summary.duration")}</div>
        <div className={styles.metricValue}>{totalDurationMin}</div>
        <div className={styles.metricSub}>{t("plan.summary.durationSub")}</div>
      </div>
      <div className={styles.metric}>
        <div className={styles.metricEyebrow}>{t("plan.summary.volume")}</div>
        <div className={styles.metricValue}>{t("plan.summary.volumePlaceholder")}</div>
        <div className={styles.metricSub}>{t("plan.summary.volumeSub")}</div>
      </div>
    </div>
  );

  // Topbar — eyebrow + plan name header (#93, server-resolved label) + lead +
  // presentational actions. Rendered full-width above the cockpit grid. The
  // plan-name <h1> stays conditional so an absent label renders no level-1
  // heading (the only other headings on the page are h2s).
  const topbar = (
    <header className={styles.topbar}>
      <div className={styles.topbarCopy}>
        <div className={styles.eyebrow}>{t("plan.hero.eyebrow")}</div>
        {planName && <h1 className={styles.pageTitle}>{planName}</h1>}
        <p className={styles.lead}>{t("plan.hero.lead")}</p>
      </div>
      {/* presentational only — no data model yet (topbar actions) */}
      <PlanToolbar />
    </header>
  );

  return (
    <PlanTrackerClient
      program={program}
      planId={planId}
      planName={planName}
      weeklyOverview={weeklyOverview}
      topbar={topbar}
      sideRail={<PlanSideRail />}
    >
      {/* Hero panel (presentational) wrapping the DATA-WIRED metrics grid. */}
      <PlanHero>{metrics}</PlanHero>

      {/* Limitation warning banner — shown above the board when warnings present */}
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

      {/* The week board (7-tile grid + detail panel + per-day Start CTA) is
          rendered by PlanTrackerClient, which owns the inline session/conflict
          state-swap (#93 Slice 3). */}
    </PlanTrackerClient>
  );
}
