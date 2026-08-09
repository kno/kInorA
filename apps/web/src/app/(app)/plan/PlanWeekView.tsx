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
 *   - the hero session copy: title, est. duration and exercise count of the
 *     recommended session, plus the real current date (#411)
 *   - the limitation-warning banner
 *   - the 7-tile Mon–Sun board with real day states + week navigation
 *     (rendered by PlanTrackerClient → DayDetailPanel)
 *
 * PRESENTATIONAL ONLY (no data model yet — see plan-presentational.tsx):
 *   - the side rail (readiness ring, today's blocks, Coach AI).
 *
 * No "use client" directive: this is a pure server component. The only server
 * call is `getWeeklyOverviewAction` (a Server Action); the browser never sees
 * API_BASE_URL.
 */

import { getLocale, getTranslations } from "next-intl/server";
import type { PlanBranding, WorkoutProgram } from "@kinora/contracts";
import { formatToday } from "@/lib/week-dates";
import styles from "./plan-week-view.module.css";
import { PlanTrackerClient } from "./PlanTrackerClient";
import { PlanHero, PlanSideRail, PlanToolbar } from "./plan-presentational";
import { estimateSessionMinutes, recommendedSession, restDays } from "./plan-utils";
import { cleanLimitationNotes } from "./limitation-notes";
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
  /**
   * Optional trainer-authored branding (15b-v2 S4). When present, the accent
   * color renders as the `--plan-accent` CSS custom property on the plan
   * container (consumed by `plan-week-view.module.css`'s accent surfaces),
   * and `title`/`trainerName` override the topbar heading + add a byline.
   * Absent branding renders exactly as before this slice (safe rollback).
   */
  branding?: PlanBranding;
  /**
   * 17d PR B. ISO-8601 instant when the plan is archived, or `null`/absent
   * when active. Archiving controls `/plans`' default list visibility, NOT
   * this deep link's reachability — `/plan?planId=X` still resolves and
   * renders fully, but visibly says so, per the corrected requirement.
   */
  archivedAt?: string | null;
}

export async function PlanWeekView({
  program,
  planName,
  planId,
  weekStart,
  branding,
  archivedAt,
}: PlanWeekViewProps) {
  const t = await getTranslations();
  const locale = await getLocale();

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

  // Hero session copy (#411) — derived from the SAME `recommendedSession` call
  // `PlanTrackerClient` uses to pick the day its Start CTA begins, so the hero
  // can never describe one session while the button starts another.
  const recommended = recommendedSession(sessions, weeklyOverview?.days);
  const heroSession = recommended && {
    title: recommended.title,
    durationMinutes: estimateSessionMinutes(recommended.exercises),
    exerciseCount: recommended.exercises.length,
  };

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
  //
  // 15b-v2 S4: a trainer-authored `branding.title` overrides the plain
  // `planName` heading, and `branding.trainerName` renders as a byline below
  // it. Absent branding leaves this identical to the pre-S4 rendering.
  const displayTitle = branding?.title ?? planName;
  const topbar = (
    <header className={styles.topbar}>
      <div className={styles.topbarCopy}>
        <div className={styles.eyebrow}>{t("plan.hero.eyebrow")}</div>
        {displayTitle && <h1 className={styles.pageTitle}>{displayTitle}</h1>}
        {archivedAt && (
          <span className={styles.archivedBadge} data-testid="plan-archived-badge">
            {t("plan.archived.badge")}
          </span>
        )}
        {branding?.trainerName && (
          <p className={styles.brandingByline}>
            {t("plan.branding.byTrainer", { trainerName: branding.trainerName })}
          </p>
        )}
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
      branding={branding}
    >
      {/* Hero panel wrapping the DATA-WIRED metrics grid. `todayLabel` is the
          real current date via the shared dashboard formatter (#411). */}
      <PlanHero todayLabel={formatToday(locale)} session={heroSession}>
        {metrics}
      </PlanHero>

      {/* Limitation warning banner — shown above the board when warnings present.
          Presentation-only fix (issue #250): the generator emits one localized
          advisory string per limitation, repeating the identical advisory tail
          on every entry. `cleanLimitationNotes` strips that tail + prefix and
          dedupes, so we list each limitation TEXT and show the advisory ONCE. */}
      {hasWarnings && (
        <div className={styles.limitationBanner} role="alert">
          <div className={styles.limitationBannerTitle}>
            {t("plan.limitation.title")}
          </div>
          <ul className={styles.limitationBannerList}>
            {cleanLimitationNotes(program.limitationWarnings).map((note) => (
              <li key={note} className={styles.limitationBannerItem}>
                {note}
              </li>
            ))}
          </ul>
          <p className={styles.limitationBannerAdvisory}>
            {t("plan.limitation.advisory")}
          </p>
        </div>
      )}

      {/* The week board (7-tile grid + detail panel + per-day Start CTA) is
          rendered by PlanTrackerClient, which owns the inline session/conflict
          state-swap (#93 Slice 3). */}
    </PlanTrackerClient>
  );
}
