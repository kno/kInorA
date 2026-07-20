"use client";

/**
 * plan-presentational.tsx — presentational-only building blocks for the
 * `/plan` cockpit, built 1:1 to `screens/web-plan.html`.
 *
 * IMPORTANT: every export in this file is presentational only — no data model
 * yet. The copy is static (sourced from the i18n catalog) and the interactive
 * bits (toast buttons, coach actions) mirror the mockup's inline script. There
 * is no server action, API call, or domain data behind any of them. The real
 * data-wired surfaces live in `PlanWeekView` (metrics), `DayDetailPanel`
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
 * CTA invokes it (actually starting the recommended session) INSTEAD of raising
 * the presentational toast. When absent (PlanHero used without a start
 * capability), the CTA keeps its original toast-only fallback.
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
 * Topbar actions — presentational only, no data model yet. "Edit plan" is a
 * real link to /create-plan; "Rebalance week" raises an ephemeral toast like
 * the mockup, with no plan mutation behind it.
 */
export function PlanToolbar() {
  const t = useTranslations("plan.hero");
  const [toast, flash] = useToast();
  return (
    <div className={styles.topbarActions}>
      <button type="button" className={styles.btn} onClick={() => flash(t("rebalanceToast"))}>
        {t("rebalanceCta")}
      </button>
      <a className={`${styles.btn} ${styles.btnPrimary}`} href="/create-plan">
        {t("editCta")}
      </a>
      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Hero panel — presentational only, no data model yet. Renders the session
 * meta pills, session copy, action buttons (toast) and the muscle body-map.
 * The `children` slot carries the DATA-WIRED metrics grid rendered by
 * `PlanWeekView` (kept as literal server JSX so it stays server-derived).
 */
export function PlanHero({ children }: { children?: React.ReactNode }) {
  const t = useTranslations("plan.hero");
  const [toast, flash] = useToast();
  // Real start handler published by PlanTrackerClient (see HeroStartContext).
  // Present on the wired `/plan` cockpit; absent for any presentational-only use.
  const onStart = React.useContext(HeroStartContext);

  return (
    <section className={`${styles.panel} ${styles.hero}`} aria-labelledby="plan-hero-title">
      <div className={styles.heroBody}>
        {/* presentational only — no data model yet (session meta pills) */}
        <div className={styles.sessionMeta}>
          <span className={`${styles.pill} ${styles.pillActive}`}>{t("pillToday")}</span>
          <span className={styles.pill}>{t("pillDuration")}</span>
          <span className={styles.pill}>{t("pillExercises")}</span>
          <span className={styles.pill}>{t("pillFocus")}</span>
        </div>
        {/* presentational only — no data model yet (today session copy) */}
        <h2 className={styles.heroTitle} id="plan-hero-title">
          {t("sessionTitle")}
        </h2>
        <p className={styles.heroLead}>{t("sessionLead")}</p>
        {/* presentational only — no data model yet (hero actions/toasts) */}
        <div className={styles.heroActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onStart ?? (() => flash(t("startToast")))}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
              <polygon points="7 4 20 12 7 20" />
            </svg>
            {t("startCta")}
          </button>
          <button type="button" className={styles.btn} onClick={() => flash(t("swapToast"))}>
            {t("swapCta")}
          </button>
        </div>
        {/* DATA-WIRED metrics grid (rendered by PlanWeekView, passed as children) */}
        {children}
      </div>

      {/* presentational only — no data model yet (muscle body-map + images) */}
      <aside className={styles.bodyMap} aria-label={t("focusLabel")}>
        <div className={styles.muscleShot}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/plan/pilot-push-male.png" alt={t("imageAlt")} />
          <div className={styles.muscleBadge}>{t("badge")}</div>
        </div>
        <div className={styles.mapLabel}>
          <div className={styles.focusRow}>
            <strong>{t("focusLabel")}</strong>
            <span className={styles.muted}>{t("focusValue")}</span>
          </div>
          <div className={styles.loadBar} aria-hidden="true">
            <span />
          </div>
          <div className={styles.imageStrip}>
            <div className={styles.imageChip}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/plan/pilot-push-male.png" alt={t("chipTodayAlt")} />
              <span>
                <b>{t("chipTodayLabel")}</b>
                {t("chipTodayText")}
              </span>
            </div>
            <div className={styles.imageChip}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/plan/pilot-leg-female.png" alt={t("chipNextAlt")} />
              <span>
                <b>{t("chipNextLabel")}</b>
                {t("chipNextText")}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
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
