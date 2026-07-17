import { getTranslations } from "next-intl/server";
import type { KpiWithDelta, StatsSummaryDTO } from "@kinora/contracts";
import { getStatsAction } from "./actions";
import type { StatsRange } from "./stats-client";

/**
 * Statistics — protected page only accessible with a valid session
 * (09c-v1-progress-dashboard-stats, Slice 3a). Built to
 * `screens/web-stats.html`. Renders the modules this slice owns: the
 * Semana/Mes/Año period toggle, the 4 KPI cards (volume, sessions, time,
 * PRs) each with a delta vs. the previous period (a null delta renders the
 * neutral "new" state, never a percentage/arrow — design.md "KPI deltas"),
 * and the volume-trend series (current vs. previous period).
 *
 * The muscle-group distribution bar chart and the PR table are Slice 3b
 * (`3b.1`-`3b.8`) — they render as clearly-marked "coming soon"
 * placeholders here so the page shell matches the design without
 * implementing that data. The workout-type donut is permanently out of
 * scope (design.md "Statistics" — workout type is not tracked).
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
  const summary = result.kind === "ok" ? result.summary : undefined;

  return (
    <main className="kin-page stats-page">
      <div className="stats-topbar">
        <h1 className="kin-title">{t("stats.title")}</h1>
        <nav className="stats-range-pills" aria-label={t("stats.title")}>
          {RANGES.map((option) => (
            <a
              key={option}
              href={`?range=${option}`}
              className={`stats-pill${option === range ? " stats-pill--active" : ""}`}
              aria-current={option === range ? "true" : undefined}
            >
              {t(RANGE_LABEL_KEYS[option])}
            </a>
          ))}
        </nav>
      </div>

      {summary ? StatsBody({ summary, t }) : <p className="kin-text kin-muted">{t("stats.description")}</p>}
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
      <div className="stats-kpi-row">
        {KpiCard({ label: t("stats.volumeLabel"), value: formatVolume(summary.totalVolumeKg.value), kpi: summary.totalVolumeKg, t })}
        {KpiCard({ label: t("stats.sessionsLabel"), value: String(summary.sessionCount.value), kpi: summary.sessionCount, t })}
        {KpiCard({ label: t("stats.durationLabel"), value: formatDuration(summary.totalDurationMin.value), kpi: summary.totalDurationMin, t })}
        {KpiCard({ label: t("stats.prLabel"), value: String(summary.prCount.value), kpi: summary.prCount, t })}
      </div>

      <article className="stats-card">
        <h2 className="kin-title">{t("stats.volumeTrendTitle")}</h2>
        {VolumeTrend({ trend: summary.volumeTrend, t })}
      </article>

      <div className="stats-placeholder-row">
        <article className="stats-card stats-placeholder">
          <h2 className="kin-title">{t("stats.distributionTitle")}</h2>
          {/* TODO(Slice 3b): computeMuscleGroupDistribution horizontal bar chart. */}
          <p className="kin-text kin-muted">{t("stats.distributionComingSoon")}</p>
        </article>
        <article className="stats-card stats-placeholder">
          <h2 className="kin-title">{t("stats.prTitle")}</h2>
          {/* TODO(Slice 3b): computePersonalRecords table (Epley 1RM + trend). */}
          <p className="kin-text kin-muted">{t("stats.prComingSoon")}</p>
        </article>
      </div>
    </>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  kpi: KpiWithDelta;
  t: Awaited<ReturnType<typeof getTranslations>>;
}

function KpiCard({ label, value, kpi, t }: KpiCardProps) {
  const delta = kpi.deltaVsPreviousPeriod;
  const isNew = delta === null;
  const isPositive = delta !== null && delta >= 0;

  return (
    <article className="stats-kpi-card">
      <div className="stats-kpi-label">{label}</div>
      <div className="stats-kpi-value num">{value}</div>
      <div className={`stats-kpi-delta ${isNew ? "stats-kpi-delta--new" : isPositive ? "stats-kpi-delta--pos" : "stats-kpi-delta--neg"}`}>
        {isNew ? t("stats.deltaNew") : `${isPositive ? "+" : ""}${Math.round(delta)}% ${t("stats.deltaSuffix")}`}
      </div>
    </article>
  );
}

interface VolumeTrendProps {
  trend: StatsSummaryDTO["volumeTrend"];
  t: Awaited<ReturnType<typeof getTranslations>>;
}

function VolumeTrend({ trend, t }: VolumeTrendProps) {
  if (trend.current.length === 0 && trend.previous.length === 0) {
    return <p className="kin-text kin-muted">{t("stats.volumeTrendEmpty")}</p>;
  }

  const maxVolume = Math.max(1, ...trend.current, ...trend.previous);

  return (
    <div className="stats-trend">
      {TrendSeries({ label: t("stats.volumeTrendCurrentLabel"), values: trend.current, max: maxVolume, variant: "current" })}
      {TrendSeries({ label: t("stats.volumeTrendPreviousLabel"), values: trend.previous, max: maxVolume, variant: "previous" })}
    </div>
  );
}

interface TrendSeriesProps {
  label: string;
  values: number[];
  max: number;
  variant: "current" | "previous";
}

function TrendSeries({ label, values, max, variant }: TrendSeriesProps) {
  return (
    <div className="stats-trend-series" data-variant={variant}>
      <span className="stats-trend-legend">{label}</span>
      <div className="stats-trend-bars">
        {values.map((value, index) => (
          <span
            key={index}
            className="stats-trend-bar"
            style={{ height: `${Math.max(4, Math.round((value / max) * 100))}%` }}
            title={`${Math.round(value)} kg`}
          />
        ))}
      </div>
    </div>
  );
}

function normalizeRange(value: string | undefined): StatsRange {
  return value === "week" || value === "year" ? value : "month";
}

function formatVolume(valueKg: number): string {
  return `${Math.round(valueKg)} kg`;
}

function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
}
