import { useTranslations } from "next-intl";
import { RING_CIRCUMFERENCE, RING_RADIUS, formatRest } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface RestRingProps {
  /** Full rest duration (seconds) used to scale the ring. */
  duration: number;
  /** Seconds left, or `null` while idle. */
  remaining: number | null;
  onSkip: () => void;
  onAddTime: () => void;
}

/** Rest countdown ring: amber, turning lime in the last 15s. Client-only. */
export function RestRing({ duration, remaining, onSkip, onAddTime }: RestRingProps) {
  const t = useTranslations("tracker");
  const active = remaining != null;
  const low = active && remaining <= 15;
  // Guard against a non-positive rest duration (e.g. an exercise configured
  // with restSeconds: 0) so the ring offset never divides by zero → Infinity.
  const safeDuration = duration > 0 ? duration : 1;
  // Clamp so a "+15 s" that pushes `remaining` past `duration` (offset < 0)
  // never wraps the ring by rendering a negative dash offset.
  const offset = active
    ? Math.max(0, RING_CIRCUMFERENCE * (1 - remaining / safeDuration))
    : 0;

  // Announced to assistive tech: the visible countdown lives inside an
  // `aria-hidden` node, so this sr-only live region carries the state + time.
  const srStatus = active
    ? t("rest.srActive", { time: formatRest(remaining) })
    : t("rest.ready");

  return (
    <section
      className={`${styles.card} ${styles.restCard}`}
      aria-label={t("rest.aria")}
    >
      <span className={styles.srOnly} aria-live="polite">
        {srStatus}
      </span>
      <div className={styles.restState}>
        <span className={styles.restHeading}>
          <span
            className={`${styles.restDot} ${active ? "" : styles.restDotIdle}`}
            aria-hidden="true"
          />
          <span>{active ? t("rest.active") : t("rest.ready")}</span>
        </span>
        <button
          type="button"
          className={styles.btn}
          onClick={onSkip}
          aria-label={t("rest.skipLabel")}
          disabled={!active}
        >
          {t("rest.skip")}
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
          <span className={styles.ringLabelSm}>{t("rest.label")}</span>
        </div>
      </div>
      <div className={styles.restActions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnWarn}`}
          onClick={onAddTime}
          aria-label={t("rest.addLabel")}
          disabled={!active}
        >
          {t("rest.addTime")}
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={onSkip}
          aria-label={t("rest.skipLabel")}
          disabled={!active}
        >
          {t("rest.skip")}
        </button>
      </div>
    </section>
  );
}
