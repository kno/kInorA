"use client";

/**
 * plan-presentational.tsx — building blocks for the `/plan` cockpit, laid out
 * to `screens/web-plan.html`.
 *
 * `PlanHero` is NO LONGER presentational (#411). It used to render the mockup's
 * session copy — a fixed date, "68 min", "6 exercises", a session title — as if
 * it were the user's data, next to a "Move to Saturday" button whose toast said
 * the session had been moved when nothing was written. Everything it renders is
 * now either derived from the real program (`PlanWeekView` passes it down) or
 * gone. A missing feature is honest; a lying one is not.
 *
 * `PlanSideRail` IS still presentational only — no data model yet. Its copy is
 * static and its coach actions mirror the mockup's inline script with no
 * coaching engine behind them. That is tracked separately from this fix.
 *
 * The data-wired surfaces live in `PlanWeekView` (metrics), `DayDetailPanel`
 * (7-tile board + per-day detail) and `PlanTrackerClient` (session lifecycle).
 */

import * as React from "react";
import { useRef, useState } from "react";
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

/** Shared ephemeral-toast hook — mirrors the dashboard presentational cards. */
function useToast(): [string | null, (message: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function flash(message: string) {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2400);
  }
  return [toast, flash];
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

/**
 * Side rail — presentational only, no data model yet. Readiness ring, today's
 * exercise blocks and the Coach AI card, all with static catalog copy. The
 * coach actions swap the note text and raise a toast, mirroring the mockup's
 * inline script; there is no coaching engine behind this.
 */
export function PlanSideRail() {
  const t = useTranslations("plan");
  const [toast, flash] = useToast();
  const [coachNote, setCoachNote] = useState<string | null>(null);

  const exercises = [1, 2, 3, 4, 5, 6].map((n) => ({
    name: t(`today.ex${n}Name`),
    sub: t(`today.ex${n}Sub`),
    load: t(`today.ex${n}Load`),
  }));

  return (
    <aside className={styles.side}>
      {/* Readiness ring — presentational only, no data model yet */}
      <section className={`${styles.panel} ${styles.todayCard}`} aria-labelledby="plan-readiness-title">
        <div className={styles.eyebrow}>{t("readiness.eyebrow")}</div>
        <h2 className={styles.cardTitle} id="plan-readiness-title">
          {t("readiness.title")}
        </h2>
        <div className={styles.readiness}>
          <div className={styles.ring} role="img" aria-label={t("readiness.ringAria")}>
            <strong className={styles.num}>82</strong>
          </div>
          <div className={styles.signalList}>
            <div className={styles.signal}>
              <span>{t("readiness.sleepLabel")}</span>
              <strong>{t("readiness.sleepValue")}</strong>
            </div>
            <div className={styles.signal}>
              <span>{t("readiness.sorenessLabel")}</span>
              <strong>{t("readiness.sorenessValue")}</strong>
            </div>
            <div className={styles.signal}>
              <span>{t("readiness.lastPushLabel")}</span>
              <strong>{t("readiness.lastPushValue")}</strong>
            </div>
            <div className={styles.signal}>
              <span>{t("readiness.recommendationLabel")}</span>
              <strong>{t("readiness.recommendationValue")}</strong>
            </div>
          </div>
        </div>
      </section>

      {/* "Bloque de hoy" — presentational only, no data model yet */}
      <section className={`${styles.panel} ${styles.exercisePanel}`} aria-labelledby="plan-today-title">
        <div className={styles.exerciseHead}>
          <div>
            <div className={styles.eyebrow}>{t("today.eyebrow")}</div>
            <h2 className={styles.cardTitle} id="plan-today-title">
              {t("today.title")}
            </h2>
          </div>
          <span className={styles.pill}>{t("today.restChip")}</span>
        </div>
        <div className={styles.exerciseList}>
          {exercises.map((exercise, index) => (
            <div
              className={`${styles.exercise}${index === 0 ? ` ${styles.exerciseActive}` : ""}`}
              key={exercise.name}
            >
              <div className={styles.exerciseIndex}>{String(index + 1).padStart(2, "0")}</div>
              <div>
                <div className={styles.exerciseName}>{exercise.name}</div>
                <div className={styles.exerciseSub}>{exercise.sub}</div>
              </div>
              <div className={styles.exerciseLoad}>
                <strong className={styles.num}>{exercise.load}</strong>
                <span>{t("today.targetLabel")}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Coach AI — presentational only, no data model yet */}
      <section className={`${styles.panel} ${styles.coach}`} aria-labelledby="plan-coach-title">
        <div>
          <div className={styles.eyebrow}>{t("coach.eyebrow")}</div>
          <h2 className={styles.cardTitle} id="plan-coach-title">
            {t("coach.title")}
          </h2>
        </div>
        <p className={styles.coachNote}>{coachNote ?? t("coach.note")}</p>
        <div className={styles.coachActions}>
          <button
            type="button"
            className={styles.ghostCard}
            onClick={() => {
              setCoachNote(t("coach.action1Note"));
              flash(t("coach.appliedToast"));
            }}
          >
            <strong>{t("coach.action1Title")}</strong>
            <span className={styles.muted}>{t("coach.action1Sub")}</span>
          </button>
          <button
            type="button"
            className={styles.ghostCard}
            onClick={() => {
              setCoachNote(t("coach.action2Note"));
              flash(t("coach.appliedToast"));
            }}
          >
            <strong>{t("coach.action2Title")}</strong>
            <span className={styles.muted}>{t("coach.action2Sub")}</span>
          </button>
        </div>
      </section>

      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </aside>
  );
}
