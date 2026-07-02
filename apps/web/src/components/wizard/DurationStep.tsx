"use client";

import { useState } from "react";
import { validateSessionDuration } from "@kinora/domain/plan";
import { OrbitSelectableCard } from "@/components/orbit";
import { DURATION_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface DurationStepProps {
  value?: number;
  onSelect: (sessionDurationMinutes: number) => void;
  messages?: Record<string, string>;
}

/**
 * Step 4 — session duration in minutes.
 *
 * Offers the static {@link DURATION_OPTIONS} plus a numeric input for a custom
 * duration. Custom input is validated against the domain bounds
 * ({@link validateSessionDuration}) before it reaches the wizard spec; invalid
 * values surface an inline error and never call `onSelect`. Domain validation
 * reasons come from the domain layer and are surfaced as-is (not translated
 * here); only the wizard's own literals are internationalized.
 */
export function DurationStep({ value, onSelect, messages = {} }: DurationStepProps) {
  const t = (key: string, fallback: string): string => messages[key] ?? fallback;

  // Seed the custom field only when the current value is not a static option,
  // so resuming a draft with a typed duration shows it back to the user.
  const isCustomValue = value != null && !DURATION_OPTIONS.includes(value);
  const [custom, setCustom] = useState(isCustomValue ? String(value) : "");
  const [error, setError] = useState<string | null>(null);

  const submitCustom = () => {
    const trimmed = custom.trim();
    if (trimmed === "") {
      setError(t("wizard_duration_error_empty", "Enter a duration in minutes."));
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
            label={t("wizard_duration_min", "{n} min").replace("{n}", String(minutes))}
            selected={value === minutes}
            onSelect={() => {
              setError(null);
              onSelect(minutes);
            }}
          >
            {minutes <= 30
              ? t("wizard_duration_quick_session", "Quick session")
              : t("wizard_duration_per_session", "Per session")}
          </OrbitSelectableCard>
        ))}
      </div>

      <div className={styles.inputRow}>
        <input
          type="number"
          className={styles.input}
          aria-label={t("wizard_duration_custom_aria", "Custom duration in minutes")}
          placeholder={t("wizard_duration_custom_placeholder", "e.g. 75")}
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
          {t("wizard_duration_set_button", "Set duration")}
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
