import { getLocale, getTranslations } from "next-intl/server";
import type { DashboardSummaryDTO } from "@kinora/contracts";
import { getDashboardAction, logoutAction } from "./actions";

/**
 * Dashboard — protected page only accessible with a valid session
 * (09c-v1-progress-dashboard-stats, Slice 2). Built to
 * `screens/web-dashboard.html`. Renders the modules this change owns:
 * the "Sesión recomendada hoy" hero, "Racha activa" + "Progreso semanal"
 * score cards, and the "Ruta de carga" week-route strip. The Coach AI card
 * and the readiness ring are explicitly out of scope (design.md
 * "Dashboard").
 *
 * The proxy (`proxy.ts`) gates this route: no `kinora_session` cookie ->
 * redirect to `/login`. Renders inside the AppShell (sidebar/topbar chrome
 * lives there, not here).
 */
export default async function DashboardPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const result = await getDashboardAction();
  const summary = result.kind === "ok" ? result.summary : undefined;
  const isEmpty = !summary || (summary.streak === 0 && summary.weeklyCompleted === 0 && summary.weeklyRollup.length === 0);

  return (
    <main className="dash-page">
      {isEmpty ? (
        <div className="dash-card dash-empty">
          <h1 className="kin-title">{t("dashboard.emptyTitle")}</h1>
          <p className="kin-text kin-muted">{t("dashboard.emptyBody")}</p>
          <a href="/create-plan" className="kin-btn kin-btn--accent">
            {t("dashboard.emptyCta")}
          </a>
        </div>
      ) : (
        <>
          <article className="dash-card">
            <div className="dash-hero-kicker">
              <span>{t("dashboard.heroKicker")}</span>
            </div>
            <h1 className="dash-hero-title">{t("dashboard.title")}</h1>
            <p className="dash-hero-lead">{t("dashboard.heroLead")}</p>
            <div className="dash-hero-actions">
              <a href="/plan" className="kin-btn kin-btn--accent">
                {t("dashboard.startSession")}
              </a>
              <a href="/plan" className="kin-btn">
                {t("dashboard.viewPlan")}
              </a>
            </div>
          </article>

          {ProgressPanel({ summary, t })}

          {summary.weeklyRollup.length > 0 && (
            <article className="dash-card">
              <div className="dash-hero-kicker">{t("dashboard.weekRouteEyebrow")}</div>
              <h2 className="kin-title">{t("dashboard.weekRouteTitle")}</h2>
              <div className="dash-week-route">
                {summary.weeklyRollup.map((day) => (
                  <div className="dash-day-card" key={day.dayIndex}>
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
        </>
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
      <article className="dash-score-card">
        <div className="dash-score-label">{t("dashboard.streakLabel")}</div>
        <div className="dash-score-value num">{summary.streak}</div>
        <div className="dash-score-sub">
          {summary.streak > 0 ? t("dashboard.streakSub", { count: summary.streak }) : t("dashboard.streakSubZero")}
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
          <span style={{ fontSize: "1.1rem", color: "var(--muted)" }}>/{summary.weeklyPlanned}</span>
        </div>
        <div className="dash-score-sub">
          {remaining > 0 ? t("dashboard.weeklySubPending", { remaining }) : t("dashboard.weeklySubDone")}
        </div>
      </article>
    </div>
  );
}

/** 0-based Monday-first weekday index (design.md convention) -> a locale-formatted short weekday label. */
function weekdayLabel(dayIndex: number, locale: string): string {
  const reference = new Date();
  const mondayOffset = (reference.getUTCDay() + 6) % 7;
  const monday = new Date(reference.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
  const day = new Date(monday.getTime() + dayIndex * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(day);
}
