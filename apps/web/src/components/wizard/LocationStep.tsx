"use client";

import type { TrainingLocation } from "@kinora/contracts";
import { OrbitSelectableCard } from "@/components/orbit";
import { LOCATION_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface LocationStepProps {
  value?: TrainingLocation;
  onSelect: (location: TrainingLocation) => void;
  messages?: Record<string, string>;
}

/** Step 2 — where the user trains. Drives the equipment options downstream. */
export function LocationStep({ value, onSelect, messages = {} }: LocationStepProps) {
  const t = (key: string, fallback: string): string => messages[key] ?? fallback;

  return (
    <div className={styles.grid}>
      {LOCATION_OPTIONS.map((option) => (
        <OrbitSelectableCard
          key={option.value}
          label={t(option.labelKey, option.labelFallback)}
          selected={value === option.value}
          onSelect={() => onSelect(option.value)}
        >
          {t(option.descriptionKey, option.descriptionFallback)}
        </OrbitSelectableCard>
      ))}
    </div>
  );
}
