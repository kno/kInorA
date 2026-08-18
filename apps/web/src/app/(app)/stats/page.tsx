import { getTranslations } from "next-intl/server";
import type { StatsSummaryDTO } from "@kinora/contracts";
import { getStatsAction } from "./actions";
import type { StatsRange } from "./stats-client";
import {
  KpiCard,
  MuscleGroupDistribution,
  PersonalRecordsTable,
  VolumeTrend,
  formatDuration,
  formatVolume,
} from "./StatsSections";
import styles from "./stats.module.css";

/**
 * Statistics — protected page only accessible with a valid session
 * (09c-v1-progress-dashboard-stats, Slice 3a). Built to
 * `screens/web-stats.html`. Renders the modules this slice owns: the
 * Semana/Mes/Año period toggle, the 4 KPI cards (volume, sessions, time,
 * PRs) each with a delta vs. the previous period (a null delta renders the
 * neutral "new" state, never a percentage/arrow — design.md "KPI deltas"),
 * and the volume-trend series (current vs. previous period).
 *
 * The muscle-group distribution bar chart and the PR table (Slice 3b) are
 * data-backed here: the distribution collapses the DTO's 10 primary
 * `MuscleGroup` buckets into 6 coarse display buckets
 * (`toCoarseMuscleGroupBars`, web-layer-only — design.md "Muscle-group
 * distribution") and the PR table renders `personalRecords[]` (estimated
 * 1RM, date, trend sparkline + signed delta). Both sections independently
 * show an empty state when there is no data, never erroring. The
 * workout-type donut is permanently out of scope (design.md "Statistics" —
 * workout type is not tracked).
 *
 * Section order and width follow the screen: the KPI row, the volume-trend
 * card, the muscle-group card, and then the personal-records card, each full
 * width. On the screen the PR card is a sibling *after* `secondary-row`
 * (web-stats.html:711), not a cell inside it; the row's other cell was the
 * donut, so with the donut out of scope the two-column row has no second
 * child left and the muscle-group card is simply a full-width section like
 * the trend card above it (kno/kInorA#443).
 *
 * The proxy (`proxy.ts`) gates this route: no `kinora_session` cookie ->
 * redirect to `/login`. Renders inside the AppShell (sidebar/topbar chrome
 * lives there, not here).
 */

const RANGES: StatsRange[] = ["week", "month", "year"];

const RANGE_LABEL_KEYS: Record<StatsRange, string> = {
  week: "stats.rangeWeek",
  month: "stats.rangeMonth",
  year: "stats.rangeYear",
};

interface StatsPageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function StatsPage({ searchParams }: StatsPageProps) {
  const params = (await searchParams) ?? {};
  const range = normalizeRange(params.range);
  const t = await getTranslations();
  const result = await getStatsAction(range);
  const loadFailed = result.kind === "error";
  const summary = result.kind === "ok" ? result.summary : undefined;

  return (
    <main className={`kin-page ${styles.page}`}>
      <div className={styles.topbar}>
        <h1 className="kin-title">{t("stats.title")}</h1>
        <nav className={styles.rangePills} aria-label={t("stats.title")}>
          {RANGES.map((option) => (
            <a
              key={option}
              href={`?range=${option}`}
              className={`${styles.pill}${option === range ? ` ${styles.pillActive}` : ""}`}
              aria-current={option === range ? "true" : undefined}
            >
              {t(RANGE_LABEL_KEYS[option])}
            </a>
          ))}
        </nav>
      </div>

      {loadFailed ? (
        <p className="kin-text" role="alert" data-testid="stats-page-error">
          {t("stats.error")}
        </p>
      ) : summary ? (
        StatsBody({ summary, t })
      ) : (
        <p className="kin-text kin-muted">{t("stats.description")}</p>
      )}
    </main>
  );
}

interface StatsBodyProps {
  summary: StatsSummaryDTO;
  t: Awaited<ReturnType<typeof getTranslations>>;
}

function StatsBody({ summary, t }: StatsBodyProps) {
  return (
    <>
      <div className={styles.kpiRow}>
        {KpiCard({ label: t("stats.volumeLabel"), value: formatVolume(summary.totalVolumeKg.value), kpi: summary.totalVolumeKg, t })}
        {KpiCard({ label: t("stats.sessionsLabel"), value: String(summary.sessionCount.value), kpi: summary.sessionCount, t })}
        {KpiCard({ label: t("stats.durationLabel"), value: formatDuration(summary.totalDurationMin.value), kpi: summary.totalDurationMin, t })}
        {KpiCard({ label: t("stats.prLabel"), value: String(summary.prCount.value), kpi: summary.prCount, t })}
      </div>

      <article className={styles.card}>
        <h2 className={styles.sectionTitle}>{t("stats.volumeTrendTitle")}</h2>
        {VolumeTrend({ trend: summary.volumeTrend, t })}
      </article>

      <article className={styles.card}>
        <h2 className={styles.sectionTitle}>{t("stats.distributionTitle")}</h2>
        {MuscleGroupDistribution({ distribution: summary.muscleGroupDistribution, t })}
      </article>

      <article className={styles.prCard}>
        <div className={styles.prCardHeader}>
          <div className={styles.prEyebrow}>{t("stats.prEyebrow")}</div>
          <h2 className={styles.sectionTitle}>{t("stats.prTitle")}</h2>
        </div>
        {PersonalRecordsTable({ personalRecords: summary.personalRecords, t })}
      </article>
    </>
  );
}

function normalizeRange(value: string | undefined): StatsRange {
  return value === "week" || value === "year" ? value : "month";
}
