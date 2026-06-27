"use client";

import { OrbitSelectableCard } from "@/components/orbit";
import { FREQUENCY_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface FrequencyStepProps {
  value?: number;
  onSelect: (daysPerWeek: number) => void;
}

/** Step 3 — weekly training frequency (daysPerWeek). */
export function FrequencyStep({ value, onSelect }: FrequencyStepProps) {
  return (
    <div className={styles.grid}>
      {FREQUENCY_OPTIONS.map((days) => (
        <OrbitSelectableCard
          key={days}
          label={`${days} days`}
          selected={value === days}
          onSelect={() => onSelect(days)}
        >
          {days >= 5 ? "High commitment" : "Per week"}
        </OrbitSelectableCard>
      ))}
    </div>
  );
}
