"use client";

import type { TrainingLocation } from "@kinora/contracts";
import { OrbitSelectableCard } from "@/components/orbit";
import { LOCATION_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface LocationStepProps {
  value?: TrainingLocation;
  onSelect: (location: TrainingLocation) => void;
}

/** Step 2 — where the user trains. Drives the equipment options downstream. */
export function LocationStep({ value, onSelect }: LocationStepProps) {
  return (
    <div className={styles.grid}>
      {LOCATION_OPTIONS.map((option) => (
        <OrbitSelectableCard
          key={option.value}
          label={option.label}
          selected={value === option.value}
          onSelect={() => onSelect(option.value)}
        >
          {option.description}
        </OrbitSelectableCard>
      ))}
    </div>
  );
}
