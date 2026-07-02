"use client";

import { OrbitSelectableCard } from "@/components/orbit";
import { FREQUENCY_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface FrequencyStepProps {
  value?: number;
  onSelect: (daysPerWeek: number) => void;
  messages?: Record<string, string>;
}

/** Step 3 — weekly training frequency (daysPerWeek). */
export function FrequencyStep({ value, onSelect, messages = {} }: FrequencyStepProps) {
  const t = (key: string, fallback: string): string => messages[key] ?? fallback;

  return (
    <div className={styles.grid}>
      {FREQUENCY_OPTIONS.map((days) => (
        <OrbitSelectableCard
          key={days}
          label={t("wizard_frequency_days", "{n} days").replace("{n}", String(days))}
          selected={value === days}
          onSelect={() => onSelect(days)}
        >
          {days >= 5
            ? t("wizard_frequency_high_commitment", "High commitment")
            : t("wizard_frequency_per_week", "Per week")}
        </OrbitSelectableCard>
      ))}
    </div>
  );
}
