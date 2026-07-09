import { useTranslations } from "next-intl";
import type { ExerciseState } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface SessionProgressProps {
  segments: Array<{ id: string; state: ExerciseState }>;
  percent: number;
  completedSets: number;
  totalSets: number;
  currentExerciseNumber: number;
  totalExercises: number;
}

/** Segmented progress bar: one segment per exercise (done/active/pending). */
export function SessionProgress({
  segments,
  percent,
  completedSets,
  totalSets,
  currentExerciseNumber,
  totalExercises,
}: SessionProgressProps) {
  const t = useTranslations("tracker");
  const label = t("progress.label", { n: currentExerciseNumber, m: totalExercises });

  // The numeric range on the progressbar is sets-based (completed/total sets),
  // so give AT a coherent spoken value that matches the exercise-based label.
  const valueText = t("progress.valuetext", {
    n: currentExerciseNumber,
    m: totalExercises,
    percent,
  });

  return (
    <section className={styles.progressCard} aria-label={t("progress.aria")}>
      <div className={styles.progressHead}>
        <strong>{label}</strong>
        <span className={styles.progressPct}>{percent}%</span>
      </div>
      <div
        className={styles.segBar}
        role="progressbar"
        aria-valuenow={completedSets}
        aria-valuemin={0}
        aria-valuemax={totalSets}
        aria-valuetext={valueText}
        aria-label={label}
      >
        {segments.map((seg) => {
          const cls =
            seg.state === "done"
              ? styles.segDone
              : seg.state === "active"
                ? styles.segActive
                : "";
          return <div key={seg.id} className={`${styles.seg} ${cls}`} />;
        })}
      </div>
    </section>
  );
}
