"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { validateSessionDuration } from "@kinora/domain/plan";
import { OrbitSelectableCard } from "@/components/orbit";
import { DURATION_OPTIONS } from "./options";
import styles from "./wizard.module.css";

/** Where the committed duration came from — a preset card or the custom input. */
export type DurationSource = "preset" | "custom";

export interface DurationStepProps {
  value?: number;
  /**
   * Commits a valid duration. `source` distinguishes a preset card click from
   * a confirmed custom entry so the shell can auto-advance on either (typing
   * never triggers this) while keeping a single commit path.
   */
  onSelect: (sessionDurationMinutes: number, source: DurationSource) => void;
}

/**
 * Step 5 — session duration in minutes.
 *
 * Offers the static {@link DURATION_OPTIONS} plus a numeric input for a custom
 * duration. Custom input is validated against the domain bounds
 * ({@link validateSessionDuration}) before it reaches the wizard spec; invalid
 * values surface an inline error and never call `onSelect`. Domain validation
 * reasons come from the domain layer and are surfaced as-is (not translated
 * here); only the wizard's own literals are internationalized.
 */
export function DurationStep({ value, onSelect }: DurationStepProps) {
  const t = useTranslations();

  // Seed the custom field only when the current value is not a static option,
  // so resuming a draft with a typed duration shows it back to the user.
  const isCustomValue = value != null && !DURATION_OPTIONS.includes(value);
  const [custom, setCustom] = useState(isCustomValue ? String(value) : "");
  const [error, setError] = useState<string | null>(null);

  const submitCustom = () => {
    const trimmed = custom.trim();
    if (trimmed === "") {
      setError(t("wizard.duration.errorEmpty"));
      return;
    }
    const result = validateSessionDuration(Number(trimmed));
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    onSelect(result.minutes, "custom");
  };

  return (
    <div className={styles.stack}>
      <div className={styles.grid}>
        {DURATION_OPTIONS.map((minutes) => (
          <OrbitSelectableCard
            key={minutes}
            label={t("wizard.duration.min", { n: minutes })}
            selected={value === minutes}
            onSelect={() => {
              setError(null);
              onSelect(minutes, "preset");
            }}
          >
            {minutes <= 30
              ? t("wizard.duration.quickSession")
              : t("wizard.duration.perSession")}
          </OrbitSelectableCard>
        ))}
      </div>

      <div className={styles.inputRow}>
        <input
          type="number"
          className={styles.input}
          aria-label={t("wizard.duration.customAria")}
          placeholder={t("wizard.duration.customPlaceholder")}
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
          {t("wizard.duration.setButton")}
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
