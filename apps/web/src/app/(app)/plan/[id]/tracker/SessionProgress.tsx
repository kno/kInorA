import type { ExerciseState, Translate } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface SessionProgressProps {
  t: Translate;
  segments: Array<{ id: string; state: ExerciseState }>;
  percent: number;
  completedSets: number;
  totalSets: number;
  currentExerciseNumber: number;
  totalExercises: number;
}

/** Segmented progress bar: one segment per exercise (done/active/pending). */
export function SessionProgress({
  t,
  segments,
  percent,
  completedSets,
  totalSets,
  currentExerciseNumber,
  totalExercises,
}: SessionProgressProps) {
  const label = t("tracker_progress_label", "Exercise {n} of {m}")
    .replace("{n}", String(currentExerciseNumber))
    .replace("{m}", String(totalExercises));

  return (
    <section className={styles.progressCard} aria-label={t("tracker_progress_aria", "Session progress")}>
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
