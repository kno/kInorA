import { useTranslations } from "next-intl";
import { formatMMSS } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface TrackerTopbarProps {
  title: string;
  elapsed: number;
  paused: boolean;
  isCompleted: boolean;
  onTogglePause: () => void;
  onRestart: () => void;
  onComplete: () => void;
}

/** Topbar: eyebrow + current-exercise H1, live timer, pause + finish controls. */
export function TrackerTopbar({
  title,
  elapsed,
  paused,
  isCompleted,
  onTogglePause,
  onRestart,
  onComplete,
}: TrackerTopbarProps) {
  const t = useTranslations("tracker");
  return (
    <header className={styles.topbar}>
      <div>
        <p className={styles.eyebrow}>{t("live.eyebrow")}</p>
        <h1 className={styles.title}>{title}</h1>
      </div>
      <div className={styles.sessionControls} aria-label={t("controlsLabel")}>
        <div className={styles.timerBox} aria-live="polite">
          <span className={styles.timerLabel}>{t("timerLabel")}</span>
          <span className={styles.timerValue}>{formatMMSS(elapsed)}</span>
        </div>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onTogglePause}
          aria-label={paused ? t("resumeLabel") : t("pauseLabel")}
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
          className={styles.iconBtn}
          onClick={onRestart}
          aria-label={t("restartLabel")}
          disabled={isCompleted}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 2.5a5.5 5.5 0 1 0 5.2 3.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <polygon points="8,0 8,5 11,2.5" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={onComplete}
          disabled={isCompleted}
        >
          {t("complete.cta")}
        </button>
      </div>
    </header>
  );
}
