import { displayNum } from "./tracker-model";
import type { Translate } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface PerformanceRailProps {
  t: Translate;
  sessionVolume: number;
  completedSets: number;
  totalSets: number;
}

/**
 * Performance rail. Volume + Series are REAL/computed. Racha (streak),
 * Descanso medio (avg rest) and the AI microadjust note are NOT backed by the
 * data contract — they render as explicit stubs ("—" + "coming soon"), never
 * faked data.
 */
export function PerformanceRail({
  t,
  sessionVolume,
  completedSets,
  totalSets,
}: PerformanceRailProps) {
  return (
    <aside className={styles.rail} aria-label={t("tracker_rail_aria", "Performance panel")}>
      <div>
        <p className={styles.eyebrow}>{t("tracker_rail_eyebrow", "Performance")}</p>
        <h2 className={styles.railTitle}>{t("tracker_rail_title", "Session summary")}</h2>
      </div>
      <div className={styles.railStatGrid}>
        <div className={styles.railStat}>
          <span>{t("tracker_metric_volume", "Volume")}</span>
          <strong>
            {displayNum(Math.round(sessionVolume))} {t("tracker_unit_kg", "kg")}
          </strong>
        </div>
        <div className={styles.railStat}>
          <span>{t("tracker_rail_series", "Sets")}</span>
          <strong>
            {completedSets}/{totalSets}
          </strong>
        </div>
        {/* STUB: avg rest is not backed by the data contract. */}
        <div className={`${styles.railStat} ${styles.railStatStub}`}>
          <span>{t("tracker_rail_avg_rest", "Avg rest")}</span>
          <strong>—</strong>
          <span className={styles.stubTag}>{t("tracker_stub_soon", "coming soon")}</span>
        </div>
        {/* STUB: streak is not backed by the data contract. */}
        <div className={`${styles.railStat} ${styles.railStatStub}`}>
          <span>{t("tracker_rail_streak", "Streak")}</span>
          <strong>—</strong>
          <span className={styles.stubTag}>{t("tracker_stub_soon", "coming soon")}</span>
        </div>
      </div>
      {/* STUB: AI microadjust copy is not backed by the data contract. */}
      <section className={styles.aiNote} aria-label={t("tracker_ai_note_heading", "Suggested microadjust")}>
        <h3>{t("tracker_ai_note_heading", "Suggested microadjust")}</h3>
        <p>{t("tracker_ai_note_stub", "AI coaching insights will appear here once available.")}</p>
      </section>
    </aside>
  );
}
