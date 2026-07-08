import { RING_CIRCUMFERENCE, RING_RADIUS, formatRest } from "./tracker-model";
import type { Translate } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface RestRingProps {
  t: Translate;
  /** Full rest duration (seconds) used to scale the ring. */
  duration: number;
  /** Seconds left, or `null` while idle. */
  remaining: number | null;
  onSkip: () => void;
  onAddTime: () => void;
}

/** Rest countdown ring: amber, turning lime in the last 15s. Client-only. */
export function RestRing({ t, duration, remaining, onSkip, onAddTime }: RestRingProps) {
  const active = remaining != null;
  const low = active && remaining <= 15;
  const offset = active ? RING_CIRCUMFERENCE * (1 - remaining / duration) : 0;

  return (
    <section
      className={`${styles.card} ${styles.restCard}`}
      aria-label={t("tracker_rest_aria", "Rest timer")}
      aria-live="polite"
    >
      <div className={styles.restState}>
        <span className={styles.restHeading}>
          <span
            className={`${styles.restDot} ${active ? "" : styles.restDotIdle}`}
            aria-hidden="true"
          />
          <span>
            {active
              ? t("tracker_rest_active", "Rest active")
              : t("tracker_rest_ready", "Ready for the set")}
          </span>
        </span>
        <button
          type="button"
          className={styles.btn}
          onClick={onSkip}
          aria-label={t("tracker_rest_skip_label", "Skip rest")}
          disabled={!active}
        >
          {t("tracker_rest_skip", "Skip")}
        </button>
      </div>
      <div className={styles.ringWrap} aria-hidden="true">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r={RING_RADIUS} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
          <circle
            cx="80"
            cy="80"
            r={RING_RADIUS}
            fill="none"
            stroke={low ? "var(--accent)" : "var(--warning)"}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE.toFixed(2)}
            strokeDashoffset={offset.toFixed(2)}
          />
        </svg>
        <div className={styles.ringCenter}>
          <span className={`${styles.ringTime} ${low ? styles.ringTimeLow : ""}`}>
            {formatRest(remaining ?? duration)}
          </span>
          <span className={styles.ringLabelSm}>{t("tracker_rest_label", "rest")}</span>
        </div>
      </div>
      <div className={styles.restActions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnWarn}`}
          onClick={onAddTime}
          aria-label={t("tracker_rest_add_label", "Add 15 seconds")}
          disabled={!active}
        >
          {t("tracker_rest_add_time", "+15 s")}
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={onSkip}
          aria-label={t("tracker_rest_skip_label", "Skip rest")}
          disabled={!active}
        >
          {t("tracker_rest_skip", "Skip")}
        </button>
      </div>
    </section>
  );
}
