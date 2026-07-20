import { getLocale, getTranslations } from "next-intl/server";
import type { DashboardSummaryDTO } from "@kinora/contracts";
import { getDashboardAction, logoutAction } from "./actions";
import { DashboardCoachCard } from "./DashboardCoachCard";
import { DashboardTodayBlock } from "./DashboardTodayBlock";

/**
 * Dashboard — protected page only accessible with a valid session
 * (09c-v1-progress-dashboard-stats). Built to `screens/web-dashboard.html`.
 *
 * Data-wired modules (from DashboardSummaryDTO):
 *  - "Racha activa" streak card ← streak + recentDailyCompletion
 *  - "Progreso semanal" card    ← weeklyCompleted / weeklyPlanned
 *  - "Ruta de carga" week-route ← weeklyRollup
 *
 * Presentational-only modules (no data model yet, marked inline): the hero
 * session copy/image/stats, the readiness ring, the Coach AI card, the
 * "Siguiente sesión" next-card, and the "Bloque de hoy" exercise list.
 *
 * The proxy (`proxy.ts`) gates this route: no `kinora_session` cookie ->
 * redirect to `/login`. Renders inside the AppShell (sidebar/mobile-nav
 * chrome lives there, not here).
 */
export default async function DashboardPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const result = await getDashboardAction();
  const summary = result.kind === "ok" ? result.summary : undefined;
  const isEmpty =
    !summary || (summary.streak === 0 && summary.weeklyCompleted === 0 && summary.weeklyRollup.length === 0);

  return (
    <main className="dash-page">
      <header className="dash-topbar">
        <div>
          <h1 className="dash-page-title">{t("dashboard.pageTitle")}</h1>
          <div className="dash-date-pill">
            <span>{formatToday(locale)}</span>
            <span aria-hidden="true">·</span>
            {/* presentational only — no data model yet (plan week number) */}
            <span>{t("dashboard.weekLabel", { week: 12 })}</span>
          </div>
        </div>
        <div className="dash-topbar-actions">
          {/* presentational only — no data model yet (search) */}
          <div className="dash-search" role="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            {t("dashboard.searchPlaceholder")}
          </div>
          {/* Notifications — presentational only, no data model yet */}
          <button type="button" className="dash-icon-btn" aria-label={t("dashboard.notificationsLabel")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
        </div>
      </header>

      {isEmpty ? (
        <div className="dash-card dash-empty">
          <h2 className="kin-title">{t("dashboard.emptyTitle")}</h2>
          <p className="kin-text kin-muted">{t("dashboard.emptyBody")}</p>
          <a href="/create-plan" className="kin-btn kin-btn--accent">
            {t("dashboard.emptyCta")}
          </a>
        </div>
      ) : (
        <div className="dash-grid">
          <section className="dash-stack">
            {/* Hero — presentational only, no data model yet (session copy, stats, image) */}
            <article className="dash-card dash-today-hero">
              <div className="dash-today-copy">
                <div>
                  <div className="dash-hero-kicker">
                    <span className="dash-pulse" aria-hidden="true" />
                    {t("dashboard.heroKicker")}
                  </div>
                  <h2 className="dash-hero-title">{t("dashboard.heroTitle")}</h2>
                  <p className="dash-hero-lead">{t("dashboard.heroLead")}</p>
                  <div className="dash-hero-stats">
                    {/* presentational only — no data model yet (hero duration) */}
                    <div className="dash-hero-stat">
                      <strong className="num">{t("dashboard.heroStatDurationValue")}</strong>
                      <span>{t("dashboard.heroStatDurationLabel")}</span>
                    </div>
                    {/* presentational only — no data model yet (hero volume stat) */}
                    <div className="dash-hero-stat">
                      <strong className="num">{t("dashboard.heroStatVolumeValue")}</strong>
                      <span>{t("dashboard.heroStatVolumeLabel")}</span>
                    </div>
                    {/* presentational only — no data model yet (hero exercise count) */}
                    <div className="dash-hero-stat">
                      <strong className="num">{t("dashboard.heroStatExercisesValue")}</strong>
                      <span>{t("dashboard.heroStatExercisesLabel")}</span>
                    </div>
                  </div>
                </div>
                <div className="dash-hero-actions">
                  <a href="/plan" className="kin-btn kin-btn--accent">
                    {t("dashboard.startSession")}
                  </a>
                  <a href="/plan" className="kin-btn">
                    {t("dashboard.viewPlan")}
                  </a>
                </div>
              </div>
              {/* presentational only — no data model yet (hero image) */}
              <div className="dash-hero-visual" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/dashboard/muscle-push-female.png" alt={t("dashboard.heroImageAlt")} />
              </div>
              {/* Readiness ring — presentational only, no data model yet */}
              <div className="dash-readiness">
                <div className="dash-ring" style={{ "--value": 82 } as React.CSSProperties}>
                  <span className="num">82</span>
                </div>
                <div>
                  <h3>{t("dashboard.readinessTitle")}</h3>
                  <p>{t("dashboard.readinessBody")}</p>
                </div>
              </div>
            </article>

            {ProgressPanel({ summary, t })}

            {summary.weeklyRollup.length > 0 && (
              <article className="dash-card dash-card-pad">
                <div className="dash-section-head">
                  <div>
                    <div className="dash-eyebrow">{t("dashboard.weekRouteEyebrow")}</div>
                    <h2 className="dash-section-title">{t("dashboard.weekRouteTitle")}</h2>
                  </div>
                  <a className="kin-muted" href="/plan">
                    {t("dashboard.weekRouteAdjust")}
                  </a>
                </div>
                <div className="dash-week-route">
                  {summary.weeklyRollup.map((day) => (
                    <div
                      className="dash-day-card"
                      key={day.dayIndex}
                      data-active={day.dayIndex === todayIndex()}
                    >
                      <strong>{weekdayLabel(day.dayIndex, locale)}</strong>
                      <small>{day.focus ?? ""}</small>
                      <div className="dash-load-track">
                        <span className="dash-load-fill" style={{ width: `${day.loadPercent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            )}
          </section>

          <aside className="dash-stack">
            <DashboardCoachCard />

            {/* "Siguiente sesión" — presentational only, no data model yet */}
            <article className="dash-card dash-next-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/dashboard/muscle-leg-female.png" alt={t("dashboard.nextImageAlt")} />
              <div>
                <div className="dash-eyebrow">{t("dashboard.nextEyebrow")}</div>
                <h3 className="dash-next-title">{t("dashboard.nextTitle")}</h3>
                <p>{t("dashboard.nextBody")}</p>
              </div>
            </article>

            <DashboardTodayBlock />
          </aside>
        </div>
      )}

      <form action={logoutAction}>
        <button type="submit" className="kin-btn kin-btn--danger">
          {t("dashboard.logout")}
        </button>
      </form>
    </main>
  );
}

interface ProgressPanelProps {
  summary: DashboardSummaryDTO;
  t: Awaited<ReturnType<typeof getTranslations>>;
}

function ProgressPanel({ summary, t }: ProgressPanelProps) {
  const remaining = Math.max(0, summary.weeklyPlanned - summary.weeklyCompleted);

  return (
    <div className="dash-progress-panel">
      <article className="dash-score-card dash-score-card--featured">
        <div className="dash-score-top">
          <div>
            <div className="dash-score-label">{t("dashboard.streakLabel")}</div>
            <div className="dash-score-value num">{summary.streak}</div>
            <div className="dash-score-sub">
              {summary.streak > 0 ? t("dashboard.streakSub", { count: summary.streak }) : t("dashboard.streakSubZero")}
            </div>
          </div>
          <span className="dash-status-chip">{t("dashboard.streakChip")}</span>
        </div>
        <div className="dash-mini-bars" aria-hidden="true">
          {summary.recentDailyCompletion.map((completed, index) => (
            <span key={index} data-completed={completed} />
          ))}
        </div>
      </article>

      <article className="dash-score-card">
        <div className="dash-score-label">{t("dashboard.weeklyLabel")}</div>
        <div className="dash-score-value num">
          {summary.weeklyCompleted}
          <span className="dash-score-value-frac">/{summary.weeklyPlanned}</span>
        </div>
        <div className="dash-score-sub">
          {remaining > 0 ? t("dashboard.weeklySubPending", { remaining }) : t("dashboard.weeklySubDone")}
        </div>
        <div className="dash-mini-bars" aria-hidden="true">
          {Array.from({ length: Math.max(summary.weeklyPlanned, 1) }).map((_, index) => (
            <span key={index} data-completed={index < summary.weeklyCompleted} />
          ))}
        </div>
      </article>
    </div>
  );
}

/** 0-based Monday-first weekday index for "today" (UTC), matching the DTO convention. */
function todayIndex(): number {
  return (new Date().getUTCDay() + 6) % 7;
}

/** 0-based Monday-first weekday index (design.md convention) -> a locale-formatted short weekday label. */
function weekdayLabel(dayIndex: number, locale: string): string {
  const reference = new Date();
  const mondayOffset = (reference.getUTCDay() + 6) % 7;
  const monday = new Date(reference.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
  const day = new Date(monday.getTime() + dayIndex * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(day);
}

/** Locale-formatted "weekday, day month" label for the topbar date pill. */
function formatToday(locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}
