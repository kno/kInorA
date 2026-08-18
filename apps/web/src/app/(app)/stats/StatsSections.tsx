import type { KpiWithDelta, PersonalRecord, StatsSummaryDTO } from "@kinora/contracts";
import { toCoarseMuscleGroupBars } from "./muscle-group-display";
import styles from "./stats.module.css";

/**
 * Presentational sections shared by the self-scoped Statistics page
 * (`stats/page.tsx`, 09c-v1-progress-dashboard-stats) and the trainer-facing
 * client-progress tab (`clients/[clientUserId]/`, GH #447).
 *
 * Extracted verbatim from `stats/page.tsx` — same `stats.module.css` module,
 * same markup, same formatting rules — so both surfaces render `StatsSummaryDTO`
 * identically instead of forking a second implementation. `PersonalRecordsTable`
 * grew one additive prop (`exerciseHref`) so the trainer surface can drill an
 * exercise name into a link; the self-scoped page passes nothing and keeps
 * rendering plain text.
 */

type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

export interface KpiCardProps {
  label: string;
  value: string;
  kpi: KpiWithDelta;
  t: Translator;
}

export function KpiCard({ label, value, kpi, t }: KpiCardProps) {
  const delta = kpi.deltaVsPreviousPeriod;
  const isNew = delta === null;
  const isPositive = delta !== null && delta >= 0;

  return (
    <article className={styles.kpiCard}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} num`}>{value}</div>
      <div className={`${styles.kpiDelta} ${isNew ? styles.kpiDeltaNew : isPositive ? styles.kpiDeltaPos : styles.kpiDeltaNeg}`}>
        {isNew ? t("stats.deltaNew") : `${isPositive ? "+" : ""}${Math.round(delta)}% ${t("stats.deltaSuffix")}`}
      </div>
    </article>
  );
}

export interface VolumeTrendProps {
  trend: StatsSummaryDTO["volumeTrend"];
  t: Translator;
}

export function VolumeTrend({ trend, t }: VolumeTrendProps) {
  if (trend.current.length === 0 && trend.previous.length === 0) {
    return <p className="kin-text kin-muted">{t("stats.volumeTrendEmpty")}</p>;
  }

  const maxVolume = Math.max(1, ...trend.current, ...trend.previous);

  return (
    <div className={styles.trend}>
      {TrendSeries({ label: t("stats.volumeTrendCurrentLabel"), values: trend.current, max: maxVolume, variant: "current" })}
      {TrendSeries({ label: t("stats.volumeTrendPreviousLabel"), values: trend.previous, max: maxVolume, variant: "previous" })}
    </div>
  );
}

export interface TrendSeriesProps {
  label: string;
  values: number[];
  max: number;
  variant: "current" | "previous";
}

export function TrendSeries({ label, values, max, variant }: TrendSeriesProps) {
  return (
    <div className={styles.trendSeries} data-variant={variant}>
      <span className={styles.trendLegend}>{label}</span>
      <div className={styles.trendBars}>
        {values.map((value, index) => (
          <span
            key={index}
            className={styles.trendBar}
            style={{ height: `${Math.max(4, Math.round((value / max) * 100))}%` }}
            title={`${Math.round(value)} kg`}
          />
        ))}
      </div>
    </div>
  );
}

export interface MuscleGroupDistributionProps {
  distribution: StatsSummaryDTO["muscleGroupDistribution"];
  t: Translator;
}

export function MuscleGroupDistribution({ distribution, t }: MuscleGroupDistributionProps) {
  const bars = toCoarseMuscleGroupBars(distribution);

  if (bars.length === 0) {
    return <p className="kin-text kin-muted">{t("stats.distributionEmpty")}</p>;
  }

  return (
    <div className={styles.barChart}>
      {bars.map((bar) => (
        <div className={styles.barRow} key={bar.group}>
          <div className={styles.barLabel}>{t(`progress.muscle.${bar.group}`)}</div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${Math.max(4, bar.percentOfMax)}%` }} />
          </div>
          <div className={`${styles.barVal} num`}>{bar.setCount}</div>
        </div>
      ))}
    </div>
  );
}

export interface PersonalRecordsTableProps {
  personalRecords: PersonalRecord[];
  t: Translator;
  /** Optional — when present, the exercise name links to that href (trainer drill-down, GH #447). */
  exerciseHref?: (exerciseTitle: string) => string;
}

export function PersonalRecordsTable({ personalRecords, t, exerciseHref }: PersonalRecordsTableProps) {
  if (personalRecords.length === 0) {
    // The PR card has no padding of its own (see `.prCard`), so the empty
    // state brings its own rather than sitting flush against the border.
    return (
      <div className={styles.prCardBody}>
        <p className="kin-text kin-muted">{t("stats.prEmpty")}</p>
      </div>
    );
  }

  return (
    <table className={styles.prTable}>
      <thead>
        <tr>
          <th>{t("stats.prExerciseHeader")}</th>
          <th>{t("stats.prEstimatedHeader")}</th>
          <th>{t("stats.prDateHeader")}</th>
          <th>{t("stats.prTrendHeader")}</th>
        </tr>
      </thead>
      <tbody>
        {personalRecords.map((record) => (
          <tr key={record.exerciseTitle}>
            <td className={styles.prExercise}>
              {exerciseHref ? <a href={exerciseHref(record.exerciseTitle)}>{record.exerciseTitle}</a> : record.exerciseTitle}
            </td>
            <td className="num">{formatEstimated1RM(record.estimated1RM)}</td>
            <td className={styles.prDate}>{formatPrDate(record.achievedAt)}</td>
            <td>{PrTrend({ trend: record.trend })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface PrTrendProps {
  trend: PersonalRecord["trend"];
}

export function PrTrend({ trend }: PrTrendProps) {
  if (!trend) {
    return <span className={`${styles.prTrend} ${styles.trendArrowFlat}`}>—</span>;
  }

  const arrowClass = trend.delta > 0 ? styles.trendArrowUp : trend.delta < 0 ? styles.trendArrowDown : styles.trendArrowFlat;
  const sign = trend.delta > 0 ? "+" : "";

  return (
    <span className={`${styles.prTrend} ${arrowClass}`}>
      {`${sign}${Math.round(trend.delta * 10) / 10} kg`}
    </span>
  );
}

export function formatEstimated1RM(valueKg: number): string {
  return `${Math.round(valueKg * 10) / 10} kg`;
}

export function formatPrDate(achievedAt: string): string {
  return achievedAt.slice(0, 10);
}

export function formatVolume(valueKg: number): string {
  return `${Math.round(valueKg)} kg`;
}

export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
}
