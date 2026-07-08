import styles from "../TrackerPanel.module.css";

interface StepperProps {
  /** Uppercase group label (e.g. "Load", "Reps"). */
  label: string;
  /** Stable id used to associate the value with its label for a11y. */
  labelId: string;
  value: string | number;
  unit: string;
  decrementLabel: string;
  incrementLabel: string;
  onDecrement: () => void;
  onIncrement: () => void;
  disabled?: boolean;
}

/**
 * Stepper — a labelled ±/value control. Presentational and reusable for both
 * the load (±2.5 kg) and reps (±1) inputs. The parent owns the value + step.
 */
export function Stepper({
  label,
  labelId,
  value,
  unit,
  decrementLabel,
  incrementLabel,
  onDecrement,
  onIncrement,
  disabled = false,
}: StepperProps) {
  return (
    <div className={styles.stepperGroup}>
      <span className={styles.stepperLabel} id={labelId}>
        {label}
      </span>
      <div className={styles.stepperControls}>
        <button
          type="button"
          className={styles.stepBtn}
          onClick={onDecrement}
          aria-label={decrementLabel}
          disabled={disabled}
        >
          −
        </button>
        <div className={styles.stepValueWrap}>
          <span className={styles.stepValue} aria-labelledby={labelId} aria-live="polite">
            {value}
          </span>
          <span className={styles.stepUnit}>{unit}</span>
        </div>
        <button
          type="button"
          className={styles.stepBtn}
          onClick={onIncrement}
          aria-label={incrementLabel}
          disabled={disabled}
        >
          +
        </button>
      </div>
    </div>
  );
}
