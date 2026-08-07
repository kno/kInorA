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

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { WeeklyDayStatus, WeeklyOverviewDTO, WorkoutSession } from "@kinora/contracts";
import styles from "./plan-week-view.module.css";
import { buildWeekTiles, estimateSessionMinutes, sessionLoadBars } from "./plan-utils";
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
   * Active-session conflict scope (#93 Slice 3; widened by 17b scope A).
   * Set when a start attempt returns a 409 `active_session_conflict`.
   * Renders a localized banner naming the plan/day and the blocking
   * session's start date, with Resume/Discard actions. The single-active
   * invariant is enforced server-side; this only surfaces it.
   */
  conflict?: {
    activePlanName?: string;
    activeDay: number | null;
    activeSessionId: string;
    activeStartedAt: string;
  };
  /**
   * 17b scope A: navigates to the blocking session's tracker. Loads it
   * directly by id (correct for both a normal conflict and the legacy
   * null-day case — it never depends on re-deriving the blocking session's
   * plan identity from the client).
   */
  onResumeSession?: (activeSessionId: string) => void;
  /**
   * 17b scope A: abandons the blocking session (after the one required
   * confirmation step below) and retries the requested start.
   */
  onDiscardSession?: () => void;
  /**
   * 17b scope A: true when the most recent Discard attempt failed — shown
   * inline, without re-triggering anything itself.
   */
  discardFailed?: boolean;
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
  onResumeSession,
  onDiscardSession,
  discardFailed,
  weeklyOverview,
}: DayDetailPanelProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [overview, setOverview] = useState(weeklyOverview);
  // 17b scope A: one required confirmation step before Discard takes effect —
  // a mis-tap next to Resume must not end a session that plausibly holds real
  // logged sets.
  const [discardConfirming, setDiscardConfirming] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  // Web /plan focus handoff: the banner renders inside this week-board panel
  // while the Hero CTA that triggered it sits elsewhere, with no natural
  // scroll path between them — moving focus (not just rendering) is the fix.
  // Depends on `conflict`'s identity, so a repeated failed start re-announces
  // and re-focuses.
  useEffect(() => {
    if (!conflict) return;
    setDiscardConfirming(false);
    bannerRef.current?.focus();
    // jsdom (most existing component tests) does not implement
    // scrollIntoView — guard defensively rather than requiring every test to
    // stub it.
    bannerRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [conflict]);

  // Resync local `overview` state whenever the `weeklyOverview` PROP changes
  // identity (e.g. the parent server component re-fetches after
  // `router.refresh()` / revisiting `/plan`). Without this, `overview` stays
  // pinned to whatever value it had at mount time, since `useState`'s
  // initializer only runs once.
  useEffect(() => {
    setOverview(weeklyOverview);
  }, [weeklyOverview]);

  const t = useTranslations();

  async function navigateWeek(targetWeekStart: string): Promise<void> {
    const result = await getWeeklyOverviewAction(targetWeekStart);
    if (result.kind === "ok") {
      setOverview(result.overview);
    }
  }

  // Derived localized conflict message (readability: no per-render fn, no
  // side effects). Empty string when there is no conflict. `date` is an ICU
  // {date, date, medium} argument — next-intl formats it per-locale, so no
  // date string is built by hand.
  const conflictText = ((): string => {
    if (!conflict) return "";
    // Defensive fallback: a malformed/missing `activeStartedAt` (should never
    // happen against the real API) must not crash ICU date formatting.
    const parsed = new Date(conflict.activeStartedAt);
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    if (!conflict.activePlanName) {
      return t("plan.start.conflict_generic", { date });
    }
    if (conflict.activeDay == null) {
      return t("plan.start.conflict_no_day", { plan: conflict.activePlanName, date });
    }
    return t("plan.start.conflict", { plan: conflict.activePlanName, n: conflict.activeDay, date });
  })();

  function handleDiscardConfirmYes(): void {
    setDiscardConfirming(false);
    onDiscardSession?.();
  }

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

  // Fixed 7-tile Monday-Sunday board (spec-fidelity fix, 09c-v1-progress-
  // dashboard-stats): every calendar day gets a tile, not just training
  // days. `overview.days` (when present) carries the real per-day status;
  // absent, every tile's `status` is `undefined` and rendering falls back
  // to session-presence-only (Slice-4a-equivalent) glyphs.
  const tiles = buildWeekTiles(sessions, overview?.days);

  return (
    <div>
      {/* Active-session conflict banner (#93 Slice 3; actionable since 17b
          scope A) — localized, names the plan/day/date the user must resume
          or discard before starting another. `tabIndex={-1}` makes it
          programmatically focusable (the web /plan focus handoff above)
          without inserting it into the tab order; `role="alert"` still
          announces it to screen readers regardless of the focus move. */}
      {conflict && (
        <div
          ref={bannerRef}
          className={styles.conflictBanner}
          role="alert"
          tabIndex={-1}
          data-testid="start-conflict"
        >
          <p>{conflictText}</p>
          <div>
            <button
              type="button"
              className="kin-btn kin-btn--secondary"
              onClick={() => onResumeSession?.(conflict.activeSessionId)}
            >
              {t("plan.start.resume")}
            </button>
            {!discardConfirming && (
              <button
                type="button"
                className="kin-btn kin-btn--secondary"
                onClick={() => setDiscardConfirming(true)}
              >
                {t("plan.start.discard")}
              </button>
            )}
          </div>
          {discardConfirming && (
            <div>
              <p>{t("plan.start.discardConfirm")}</p>
              <button type="button" className="kin-btn kin-btn--primary" onClick={handleDiscardConfirmYes}>
                {t("plan.start.discardConfirmYes")}
              </button>
              <button
                type="button"
                className="kin-btn kin-btn--secondary"
                onClick={() => setDiscardConfirming(false)}
              >
                {t("plan.start.discardCancel")}
              </button>
            </div>
          )}
          {discardFailed && <p role="status">{t("plan.start.discardFailed")}</p>}
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

      {/* Fixed 7-tile Monday-Sunday day grid (spec-fidelity fix): every
          calendar day is a tile, not just training days. Training-day tiles
          (a matching `session` exists) are interactive and match the
          Slice-4a anatomy unchanged; non-training days render as
          non-interactive rest tiles (web-plan.html `.day-card.rest`). */}
      <div className={styles.dayGrid}>
        {tiles.map((tile) => {
          const { session, status, dayNumber } = tile;
          const dayLabel = t("plan.day.label", { n: dayNumber });
          const restLabel = t("plan.dayState.rest");

          if (!session) {
            // Real rest tile — no training session planned on this day.
            // Still shows the real status glyph when a `weeklyOverview` is
            // present (e.g. a "done" day outside the current plan's
            // training days), otherwise the neutral rest glyph.
            const glyph = status ? STATE_GLYPHS[status] : "–";
            return (
              <div
                key={dayNumber}
                data-testid="week-tile"
                className={`${styles.dayCard} ${styles.dayCardRest}`}
              >
                <div className={styles.dayTop}>
                  <div className={styles.dcDayLabel}>{dayLabel}</div>
                  <div
                    className={styles.dcStateGlyph}
                    data-testid="day-card-state"
                    aria-label={status ? t(`plan.dayState.${status}`) : restLabel}
                  >
                    {glyph}
                  </div>
                </div>
                <div className={styles.dcFocus}>{restLabel}</div>
              </div>
            );
          }

          const isActive = session.day === selectedDay;
          const estMin = estimateSessionMinutes(session.exercises);
          const exercisesLabel = `${session.exercises.length} ${t("plan.exercises.count")}`;
          const durationLabel = t("plan.est_duration", { n: estMin });
          const loadBars = sessionLoadBars(session.exercises);
          const glyph = status ? STATE_GLYPHS[status] : "•";
          const stateLabel = status ? t(`plan.dayState.${status}`) : undefined;

          return (
            <div
              key={dayNumber}
              data-testid="week-tile"
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
                    every training-day tile renders the same neutral glyph
                    (Slice 4a). A "rest" status here means a past-skipped
                    planned training day — NOT a "missed" state; the tile
                    stays fully interactive and shows the real session data. */}
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
                      {/* Technique link (#352 slice A). `catalogId` is resolved
                          SERVER-SIDE (persisted at generation, or derived on
                          read for pre-slice-B plans) — the browser never
                          matches names, because only the API depends on
                          `@kinora/exercise-catalog`. An unresolved exercise
                          renders NOTHING here: no link, no placeholder, no
                          reserved space. The prescribed `name` above is the
                          snapshot and is never replaced by the catalog's
                          spelling. The accessible name repeats the exercise so
                          a screen-reader user scanning links does not hear
                          "Technique" N times with no way to tell them apart. */}
                      {exercise.catalogId && (
                        <a
                          className={styles.exerciseTechniqueLink}
                          href={`/exercises/${exercise.catalogId}`}
                          data-testid="exercise-technique-link"
                          aria-label={t("exercises.technique.linkA11y", {
                            exercise: exercise.name,
                          })}
                        >
                          {t("exercises.technique.link")}
                        </a>
                      )}
                      {exercise.notes && (
                        <span className={styles.exerciseNote}>{exercise.notes}</span>
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
