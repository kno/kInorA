"use client";

import { useState } from "react";
import { validateSessionDuration } from "@kinora/domain/plan";
import { OrbitSelectableCard } from "@/components/orbit";
import { DURATION_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface DurationStepProps {
  value?: number;
  onSelect: (sessionDurationMinutes: number) => void;
}

/**
 * Step 4 — session duration in minutes.
 *
 * Offers the static {@link DURATION_OPTIONS} plus a numeric input for a custom
 * duration. Custom input is validated against the domain bounds
 * ({@link validateSessionDuration}) before it reaches the wizard spec; invalid
 * values surface an inline error and never call `onSelect`.
 */
export function DurationStep({ value, onSelect }: DurationStepProps) {
  // Seed the custom field only when the current value is not a static option,
  // so resuming a draft with a typed duration shows it back to the user.
  const isCustomValue = value != null && !DURATION_OPTIONS.includes(value);
  const [custom, setCustom] = useState(isCustomValue ? String(value) : "");
  const [error, setError] = useState<string | null>(null);

  const submitCustom = () => {
    const trimmed = custom.trim();
    if (trimmed === "") {
      setError("Enter a duration in minutes.");
      return;
    }
    const result = validateSessionDuration(Number(trimmed));
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    onSelect(result.minutes);
  };

  return (
    <div className={styles.stack}>
      <div className={styles.grid}>
        {DURATION_OPTIONS.map((minutes) => (
          <OrbitSelectableCard
            key={minutes}
            label={`${minutes} min`}
            selected={value === minutes}
            onSelect={() => {
              setError(null);
              onSelect(minutes);
            }}
          >
            {minutes <= 30 ? "Quick session" : "Per session"}
          </OrbitSelectableCard>
        ))}
      </div>

      <div className={styles.inputRow}>
        <input
          type="number"
          className={styles.input}
          aria-label="Custom duration in minutes"
          placeholder="e.g. 75"
          inputMode="numeric"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitCustom();
            }
          }}
        />
        <button
          type="button"
          className={styles.addButton}
          onClick={submitCustom}
        >
          Set duration
        </button>
      </div>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
