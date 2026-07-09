import { useTranslations } from "next-intl";
import { displayNum } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface PerformanceRailProps {
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
  sessionVolume,
  completedSets,
  totalSets,
}: PerformanceRailProps) {
  const t = useTranslations("tracker");
  return (
    <aside className={styles.rail} aria-label={t("rail.aria")}>
      <div>
        <p className={styles.eyebrow}>{t("rail.eyebrow")}</p>
        <h2 className={styles.railTitle}>{t("rail.title")}</h2>
      </div>
      <div className={styles.railStatGrid}>
        <div className={styles.railStat}>
          <span>{t("metric.volume")}</span>
          <strong>
            {displayNum(Math.round(sessionVolume))} {t("unit.kg")}
          </strong>
        </div>
        <div className={styles.railStat}>
          <span>{t("rail.series")}</span>
          <strong>
            {completedSets}/{totalSets}
          </strong>
        </div>
        {/* STUB: avg rest is not backed by the data contract. */}
        <div className={`${styles.railStat} ${styles.railStatStub}`}>
          <span>{t("rail.avgRest")}</span>
          <strong>—</strong>
          <span className={styles.stubTag}>{t("stubSoon")}</span>
        </div>
        {/* STUB: streak is not backed by the data contract. */}
        <div className={`${styles.railStat} ${styles.railStatStub}`}>
          <span>{t("rail.streak")}</span>
          <strong>—</strong>
          <span className={styles.stubTag}>{t("stubSoon")}</span>
        </div>
      </div>
      {/* STUB: AI microadjust copy is not backed by the data contract. */}
      <section className={styles.aiNote} aria-label={t("aiNote.heading")}>
        <h3>{t("aiNote.heading")}</h3>
        <p>{t("aiNote.stub")}</p>
      </section>
    </aside>
  );
}
