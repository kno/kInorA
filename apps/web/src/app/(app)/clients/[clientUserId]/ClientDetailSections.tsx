import type { ClientSummaryDTO } from "@kinora/contracts";
import type {
  FetchClientDashboardResult,
  FetchClientExerciseDetailResult,
  FetchClientProgressStatsResult,
  FetchClientWeeklyOverviewResult,
} from "../trainer-client-types";
import type { StatsRange } from "@/app/(app)/stats/stats-client";
import {
  KpiCard,
  MuscleGroupDistribution,
  PersonalRecordsTable,
  VolumeTrend,
  formatDuration,
  formatVolume,
} from "@/app/(app)/stats/StatsSections";
import styles from "./client-detail.module.css";

/**
 * Presentational sections for the trainer client-detail surface
 * (GH #447 — PR 2/2, web). Built to `web-clients.html`'s detail panel:
 * identity header + tab nav, and the Dashboard/Progress/Plan tab bodies.
 * Server-rendered like `stats/page.tsx` — plain functions returning JSX,
 * called directly rather than as JSX elements, driven entirely by the
 * page's query params (`?tab=&range=&exercise=&weekStart=`), no client JS.
 *
 * No invented data: every number here comes from a DTO the API actually
 * returns. A section with no data renders its own honest empty state
 * instead of a fabricated number (project rule — see #420).
 */

export type Translator = (key: string, values?: Record<string, string | number | Date>) => string;
export type DetailTab = "dashboard" | "progress" | "plan";

/**
 * Joins a query-string fragment onto `base`, using `?` when `base` has no
 * query yet and `&` when it already does. The `/clients` master-detail
 * workspace passes `hrefBase="/clients?client=<id>"` (already carrying a
 * query), while the standalone route's default base (`/clients/:id`) has
 * none — naively appending a literal `?` at every join site produced a
 * malformed double-`?` URL for the workspace shape (GH #460 review).
 */
export function appendParams(base: string, query: string): string {
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

export function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export interface ClientDetailHeaderProps {
  client: ClientSummaryDTO;
  tab: DetailTab;
  t: Translator;
  /**
   * Base path for the tab links, defaulting to the standalone detail route
   * (`/clients/:clientUserId`). The `/clients` master-detail workspace passes
   * `/clients?client=:clientUserId` instead, so selecting a tab stays on the
   * SAME page rather than navigating to the standalone route (GH #447
   * workspace closeout).
   */
  hrefBase?: string;
}

export function ClientDetailHeader({ client, tab, t, hrefBase }: ClientDetailHeaderProps) {
  const isActive = client.status === "active";
  const base = hrefBase ?? `/clients/${client.clientUserId}`;

  return (
    <>
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(client.email)}
          </span>
          <div>
            <h1 className="kin-title">{client.email}</h1>
            <p className="kin-text kin-muted">{t(`clients.status.${client.status}`)}</p>
          </div>
        </div>
        <div className={styles.quickActions}>
          <a className="kin-btn kin-btn--accent" href={`/clients/${client.clientUserId}/create-plan`} aria-disabled={!isActive}>
            {t("clients.createPlanCta")}
          </a>
        </div>
      </div>

      <nav className={styles.tabs} aria-label={t("clients.detail.tabsAria")}>
        {(["dashboard", "progress", "plan"] as const).map((option) => (
          <a
            key={option}
            className={`${styles.tab}${option === tab ? ` ${styles.tabActive}` : ""}`}
            href={appendParams(base, `tab=${option}`)}
            aria-current={option === tab ? "page" : undefined}
            data-testid={`client-detail-tab-${option}`}
          >
            {t(`clients.detail.tabs.${option}`)}
          </a>
        ))}
      </nav>
    </>
  );
}

export interface DashboardTabProps {
  result: FetchClientDashboardResult;
  t: Translator;
}

export function DashboardTab({ result, t }: DashboardTabProps) {
  if (result.kind === "forbidden") {
    return ForbiddenNotice({ t });
  }
  if (result.kind === "error") {
    return (
      <p className="kin-text" role="alert" data-testid="client-dashboard-error">
        {t("clients.detail.loadError")}
      </p>
    );
  }

  const { dashboard } = result;
  const hasRpeData = dashboard.rpeTrend.some((point) => point.meanRpe !== null);

  return (
    <div data-testid="client-dashboard-tab">
      <div className={styles.grid}>
        <article className={styles.statCard}>
          <div className="kin-text kin-muted">{t("clients.dashboard.completionRateLabel")}</div>
          <div className="num kin-title">{dashboard.completionRate.percent}%</div>
          <div className="kin-text kin-muted">
            {t("clients.dashboard.completionRateSub", {
              completed: dashboard.completionRate.completed,
              planned: dashboard.completionRate.planned,
            })}
          </div>
        </article>
      </div>

      <section className="kin-card">
        <h2 className="kin-title">{t("clients.dashboard.rpeTrendTitle")}</h2>
        {hasRpeData ? (
          <ul className={styles.sessionList} aria-label={t("clients.dashboard.rpeTrendTitle")}>
            {dashboard.rpeTrend.map((point) => (
              <li className={styles.sessionRow} key={point.weekStart}>
                <span>{point.weekStart}</span>
                <span className="num">{point.meanRpe === null ? "—" : point.meanRpe.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="kin-text kin-muted">{t("clients.dashboard.noRpeData")}</p>
        )}
      </section>

      <section className="kin-card">
        <h2 className="kin-title">{t("clients.dashboard.recentSessionsTitle")}</h2>
        {dashboard.recentSessions.length === 0 ? (
          <p className="kin-text kin-muted">{t("clients.dashboard.noSessions")}</p>
        ) : (
          <ul className={styles.sessionList} aria-label={t("clients.dashboard.recentSessionsTitle")}>
            {dashboard.recentSessions.map((session) => (
              <li className={styles.sessionRow} key={session.date}>
                <span>{session.date}</span>
                <span className="num">{formatVolume(session.volumeKg)}</span>
                <span className="num">{session.meanRpe === null ? "—" : `RPE ${session.meanRpe.toFixed(1)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export interface ProgressTabProps {
  clientUserId: string;
  range: StatsRange;
  statsResult: FetchClientProgressStatsResult;
  exerciseTitle?: string;
  exerciseResult?: FetchClientExerciseDetailResult;
  t: Translator;
  /** See {@link ClientDetailHeaderProps.hrefBase}. */
  hrefBase?: string;
}

const RANGES: StatsRange[] = ["week", "month", "year"];

export function ProgressTab({
  clientUserId,
  range,
  statsResult,
  exerciseTitle,
  exerciseResult,
  t,
  hrefBase,
}: ProgressTabProps) {
  if (statsResult.kind === "forbidden") {
    return ForbiddenNotice({ t });
  }
  if (statsResult.kind === "error") {
    return (
      <p className="kin-text" role="alert" data-testid="client-progress-error">
        {t("clients.detail.loadError")}
      </p>
    );
  }

  const { summary } = statsResult;
  const base = appendParams(hrefBase ?? `/clients/${clientUserId}`, "tab=progress");

  return (
    <div data-testid="client-progress-tab">
      <nav className={styles.tabs} aria-label={t("clients.progress.rangeAria")}>
        {RANGES.map((option) => (
          <a
            key={option}
            className={`${styles.tab}${option === range ? ` ${styles.tabActive}` : ""}`}
            href={appendParams(base, `range=${option}`)}
            aria-current={option === range ? "page" : undefined}
            data-testid={`client-progress-range-${option}`}
          >
            {t(`stats.range${option[0]!.toUpperCase()}${option.slice(1)}`)}
          </a>
        ))}
      </nav>

      <div className={styles.grid}>
        {KpiCard({ label: t("stats.volumeLabel"), value: formatVolume(summary.totalVolumeKg.value), kpi: summary.totalVolumeKg, t })}
        {KpiCard({ label: t("stats.sessionsLabel"), value: String(summary.sessionCount.value), kpi: summary.sessionCount, t })}
        {KpiCard({ label: t("stats.durationLabel"), value: formatDuration(summary.totalDurationMin.value), kpi: summary.totalDurationMin, t })}
        {KpiCard({ label: t("stats.prLabel"), value: String(summary.prCount.value), kpi: summary.prCount, t })}
      </div>

      <section className="kin-card">
        <h2 className="kin-title">{t("stats.volumeTrendTitle")}</h2>
        {VolumeTrend({ trend: summary.volumeTrend, t })}
      </section>

      <section className="kin-card">
        <h2 className="kin-title">{t("stats.distributionTitle")}</h2>
        {MuscleGroupDistribution({ distribution: summary.muscleGroupDistribution, t })}
      </section>

      <section className="kin-card">
        <h2 className="kin-title">{t("stats.prTitle")}</h2>
        {PersonalRecordsTable({
          personalRecords: summary.personalRecords,
          t,
          exerciseHref: (title) =>
            appendParams(appendParams(base, `range=${range}`), `exercise=${encodeURIComponent(title)}`),
        })}
      </section>

      {exerciseTitle && exerciseResult && ExerciseDetailSection({ exerciseTitle, result: exerciseResult, t })}
    </div>
  );
}

interface ExerciseDetailSectionProps {
  exerciseTitle: string;
  result: FetchClientExerciseDetailResult;
  t: Translator;
}

function ExerciseDetailSection({ exerciseTitle, result, t }: ExerciseDetailSectionProps) {
  return (
    <section className="kin-card" data-testid="client-exercise-detail">
      <h2 className="kin-title">{t("clients.progress.exerciseDetailTitle", { exercise: exerciseTitle })}</h2>
      {result.kind === "forbidden" ? (
        ForbiddenNotice({ t })
      ) : result.kind === "error" ? (
        <p className="kin-text" role="alert">
          {t("clients.detail.loadError")}
        </p>
      ) : result.detail.recentSets.length === 0 ? (
        <p className="kin-text kin-muted">{t("clients.progress.exerciseDetailEmpty")}</p>
      ) : (
        <ul className={styles.setsList}>
          {result.detail.recentSets.map((set, index) => (
            <li className={styles.setRow} key={`${set.completedAt}-${index}`}>
              <span>{set.completedAt}</span>
              <span className="num">{set.weightKg !== undefined ? `${set.weightKg} kg` : "—"}</span>
              <span className="num">{set.actualReps !== undefined ? `${set.actualReps} reps` : "—"}</span>
              <span className="num">{set.rpe !== undefined ? `RPE ${set.rpe}` : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface PlanTabProps {
  clientUserId: string;
  weekResult: FetchClientWeeklyOverviewResult;
  t: Translator;
  /** See {@link ClientDetailHeaderProps.hrefBase}. */
  hrefBase?: string;
}

export function PlanTab({ clientUserId, weekResult, t, hrefBase }: PlanTabProps) {
  if (weekResult.kind === "forbidden") {
    return ForbiddenNotice({ t });
  }
  if (weekResult.kind === "error") {
    return (
      <p className="kin-text" role="alert" data-testid="client-plan-error">
        {t("clients.detail.loadError")}
      </p>
    );
  }

  const { overview } = weekResult;
  const base = appendParams(hrefBase ?? `/clients/${clientUserId}`, "tab=plan");

  return (
    <div data-testid="client-plan-tab">
      <div className={styles.weekNav}>
        <a className="kin-btn" href={appendParams(base, `weekStart=${overview.previousWeekStart}`)}>
          {t("clients.plan.previousWeek")}
        </a>
        <h2 className="kin-title">{overview.weekLabel}</h2>
        <a className="kin-btn" href={appendParams(base, `weekStart=${overview.nextWeekStart}`)}>
          {t("clients.plan.nextWeek")}
        </a>
      </div>

      {overview.days.length === 0 ? (
        <p className="kin-text kin-muted">{t("clients.plan.empty")}</p>
      ) : (
        <div className={styles.weekGrid} aria-label={t("clients.plan.weekAria")}>
          {overview.days.map((day) => (
            <div
              className={`${styles.weekDay}${day.status === "done" ? ` ${styles.weekDayDone}` : ""}`}
              key={day.date}
              data-testid="client-plan-day"
            >
              <div className="kin-text kin-muted">{day.date}</div>
              <div className="kin-text">{day.focus ?? t(`clients.plan.status.${day.status}`)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ForbiddenNotice({ t }: { t: Translator }) {
  return (
    <p className="kin-text" role="alert" data-testid="client-detail-forbidden">
      {t("clients.accessRestrictedBody")}
    </p>
  );
}
