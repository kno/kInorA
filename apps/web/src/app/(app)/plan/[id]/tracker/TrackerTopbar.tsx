import type { Translate } from "./tracker-model";
import { formatMMSS } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface TrackerTopbarProps {
  t: Translate;
  title: string;
  elapsed: number;
  paused: boolean;
  isCompleted: boolean;
  onTogglePause: () => void;
  onComplete: () => void;
}

/** Topbar: eyebrow + current-exercise H1, live timer, pause + finish controls. */
export function TrackerTopbar({
  t,
  title,
  elapsed,
  paused,
  isCompleted,
  onTogglePause,
  onComplete,
}: TrackerTopbarProps) {
  return (
    <header className={styles.topbar}>
      <div>
        <p className={styles.eyebrow}>{t("tracker_live_eyebrow", "Active session")}</p>
        <h1 className={styles.title}>{title}</h1>
      </div>
      <div className={styles.sessionControls} aria-label={t("tracker_controls_label", "Session controls")}>
        <div className={styles.timerBox} aria-live="polite">
          <span className={styles.timerLabel}>{t("tracker_timer_label", "Time")}</span>
          <span className={styles.timerValue}>{formatMMSS(elapsed)}</span>
        </div>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onTogglePause}
          aria-label={
            paused
              ? t("tracker_resume_label", "Resume session")
              : t("tracker_pause_label", "Pause session")
          }
          aria-pressed={paused}
          disabled={isCompleted}
        >
          {paused ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <polygon points="3,2 14,8 3,14" fill="currentColor" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3" y="2" width="4" height="12" rx="1.5" fill="currentColor" />
              <rect x="9" y="2" width="4" height="12" rx="1.5" fill="currentColor" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={onComplete}
          disabled={isCompleted}
        >
          {t("tracker_complete_cta", "Complete workout")}
        </button>
      </div>
    </header>
  );
}
