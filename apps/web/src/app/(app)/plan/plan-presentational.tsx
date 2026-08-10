"use client";

/**
 * plan-presentational.tsx — building blocks for the `/plan` cockpit, laid out
 * to `screens/web-plan.html`.
 *
 * Nothing in this file is presentational any more. Everything it renders is
 * derived from the real program, the real clock, or a real handler.
 *
 * `PlanHero` stopped rendering the mockup's session copy in #411 — a fixed
 * date, "68 min", "6 exercises", a session title — next to a "Move to Saturday"
 * button whose toast said the session had been moved when nothing was written.
 *
 * `PlanSideRail` was removed entirely in #420. It rendered a readiness ring
 * whose `82` was a literal in JSX (and "Readiness 82 percent" in its
 * `aria-label`), sleep / soreness / last-push signals for measurements this app
 * does not take, six invented exercises beside the hero's real session, and a
 * "Coach AI" card prescribing specific loads ("Keep bench at 82.5 kg") with two
 * buttons that toasted "Suggestion applied to your plan" and wrote nothing.
 * A fitness app must not hand a user a training prescription it did not derive.
 * The repo does have real adaptation (14a/14b: adherence and RPE,
 * server-authoritative, suggest-and-confirm); a coaching surface belongs on top
 * of that, as a designed feature, not as static copy.
 *
 * The data-wired surfaces live in `PlanWeekView` (metrics), `DayDetailPanel`
 * (7-tile board + per-day detail) and `PlanTrackerClient` (session lifecycle).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import styles from "./plan-week-view.module.css";

/**
 * Runtime bridge for the hero's primary "start session" CTA.
 *
 * `PlanHero` is composed server-side (inside `PlanWeekView`) and handed to the
 * client `PlanTrackerClient` as part of its `children` slot, so it cannot
 * receive the session-start handler as an ordinary prop. `PlanTrackerClient`
 * publishes the real handler through this context; when it is present, the hero
 * renders its "Start session" CTA and the CTA invokes it.
 *
 * When absent (PlanHero used without a start capability) the CTA is NOT
 * rendered at all. It previously fell back to a toast reading "Session started"
 * — a button that reported starting a session it never started (#411).
 */
const HeroStartContext = React.createContext<(() => void) | undefined>(undefined);

/** Provider published by `PlanTrackerClient` so a descendant `PlanHero` CTA can start the session. */
export function PlanHeroStartProvider({
  onStart,
  children,
}: {
  onStart?: () => void;
  children?: React.ReactNode;
}) {
  return <HeroStartContext.Provider value={onStart}>{children}</HeroStartContext.Provider>;
}

/**
 * Topbar actions. "Edit plan" is a real link to /create-plan.
 *
 * The mockup's "Rebalance week" button was removed for #411: it raised a toast
 * reading "Week rebalanced: HIIT eases and strength keeps priority" and mutated
 * nothing. Rebalancing a week is a real feature that needs its own model (what
 * moves, what displaces what, how it survives a plan edit), not a button that
 * claims to have done it.
 */
export function PlanToolbar() {
  const t = useTranslations("plan.hero");
  return (
    <div className={styles.topbarActions}>
      <a className={`${styles.btn} ${styles.btnPrimary}`} href="/create-plan">
        {t("editCta")}
      </a>
    </div>
  );
}

/** The recommended session, reduced to exactly what the hero can truthfully show. */
export interface PlanHeroSession {
  /** `WorkoutSession.title` verbatim. */
  title: string;
  /** `estimateSessionMinutes(session.exercises)` — the same estimator the metrics tile uses. */
  durationMinutes: number;
  /** `session.exercises.length`. */
  exerciseCount: number;
}

export interface PlanHeroProps {
  /**
   * The real current date, already locale-formatted by `PlanWeekView` via the
   * shared `formatToday` (the same formatter the dashboard topbar pill uses).
   * Formatted upstream because this is a client component and the locale is
   * only resolvable server-side.
   */
  todayLabel: string;
  /**
   * The recommended session — the SAME one the Start CTA begins. Absent only
   * when the program has no sessions at all, in which case the hero says so
   * instead of inventing one.
   */
  session?: PlanHeroSession;
  /** DATA-WIRED metrics grid rendered by `PlanWeekView` (kept as server JSX). */
  children?: React.ReactNode;
}

/**
 * Hero panel. Every value it renders is derived from the real program or the
 * real clock (#411).
 *
 * Removed rather than wired, because no data model backs them:
 *  - the muscle body-map (a fixed illustration, a "Push active" badge and a
 *    "Chest · shoulders · triceps" focus line, none of which follow the plan)
 *  - the session lead paragraph and the "Push + pull" focus pill
 *  - the "Move to Saturday" button, whose toast said the session had been moved
 */
export function PlanHero({ todayLabel, session, children }: PlanHeroProps) {
  const t = useTranslations("plan.hero");
  // Real start handler published by PlanTrackerClient (see HeroStartContext).
  // Present on the wired `/plan` cockpit; absent for any presentational-only use.
  const onStart = React.useContext(HeroStartContext);

  return (
    <section className={`${styles.panel} ${styles.hero}`} aria-labelledby="plan-hero-title">
      <div className={styles.heroBody}>
        <div className={styles.sessionMeta}>
          <span className={`${styles.pill} ${styles.pillActive}`}>
            {t("pillToday", { date: todayLabel })}
          </span>
          {session && (
            <span className={styles.pill}>
              {t("pillDuration", { minutes: session.durationMinutes })}
            </span>
          )}
          {session && (
            <span className={styles.pill}>
              {t("pillExercises", { count: session.exerciseCount })}
            </span>
          )}
        </div>
        <h2 className={styles.heroTitle} id="plan-hero-title">
          {session ? session.title : t("noSessionTitle")}
        </h2>
        {/* The CTA renders ONLY when a real start handler is wired — see
            HeroStartContext. No handler means no button, not a fake one. */}
        {onStart && (
          <div className={styles.heroActions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onStart}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
                <polygon points="7 4 20 12 7 20" />
              </svg>
              {t("startCta")}
            </button>
          </div>
        )}
        {/* DATA-WIRED metrics grid (rendered by PlanWeekView, passed as children) */}
        {children}
      </div>
    </section>
  );
}
