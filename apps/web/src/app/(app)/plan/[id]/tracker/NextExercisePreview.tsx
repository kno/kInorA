import type { SessionExerciseRecord } from "@kinora/contracts";
import type { Translate } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface NextExercisePreviewProps {
  t: Translate;
  nextExercise?: SessionExerciseRecord;
}

/** "Up next" preview derived from the next exercise in the session. */
export function NextExercisePreview({ t, nextExercise }: NextExercisePreviewProps) {
  return (
    <section className={`${styles.card} ${styles.nextCard}`}>
      <h3>{t("tracker_next_heading", "Up next")}</h3>
      {nextExercise ? (
        <div className={styles.nextExercise}>
          <div className={styles.nextIcon} aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="7" r="3" />
              <path d="M5 19c0-3.3 2.7-6 6-6s6 2.7 6 6" />
            </svg>
          </div>
          <div>
            <p className={styles.nextName}>{nextExercise.title}</p>
            <p className={styles.nextDetail}>
              {t("tracker_next_sets", "{n} sets").replace(
                "{n}",
                String(nextExercise.setRecords.length),
              )}
            </p>
          </div>
        </div>
      ) : (
        <p className={styles.nextEmpty}>{t("tracker_next_empty", "Last exercise of the session.")}</p>
      )}
    </section>
  );
}
