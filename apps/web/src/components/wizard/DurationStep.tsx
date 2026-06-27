"use client";

import { OrbitSelectableCard } from "@/components/orbit";
import { DURATION_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface DurationStepProps {
  value?: number;
  onSelect: (sessionDurationMinutes: number) => void;
}

/** Step 4 — session duration in minutes. */
export function DurationStep({ value, onSelect }: DurationStepProps) {
  return (
    <div className={styles.grid}>
      {DURATION_OPTIONS.map((minutes) => (
        <OrbitSelectableCard
          key={minutes}
          label={`${minutes} min`}
          selected={value === minutes}
          onSelect={() => onSelect(minutes)}
        >
          {minutes <= 30 ? "Quick session" : "Per session"}
        </OrbitSelectableCard>
      ))}
    </div>
  );
}
