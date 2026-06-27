"use client";

import type { TrainingLocation } from "@kinora/contracts";
import { OrbitSelectableCard } from "@/components/orbit";
import { equipmentForLocation } from "./options";
import styles from "./wizard.module.css";

export interface EquipmentStepProps {
  value?: string[];
  /** The location selected in the previous step — constrains the options. */
  location?: TrainingLocation;
  onSelect: (equipment: string[]) => void;
}

/**
 * Step 5 — available equipment. Multi-select, filtered by the chosen location.
 * An empty selection is valid (the step is complete once visited).
 */
export function EquipmentStep({ value = [], location, onSelect }: EquipmentStepProps) {
  const options = equipmentForLocation(location);

  const toggle = (item: string) => {
    if (value.includes(item)) {
      onSelect(value.filter((v) => v !== item));
    } else {
      onSelect([...value, item]);
    }
  };

  return (
    <div className={styles.grid}>
      {options.map((option) => (
        <OrbitSelectableCard
          key={option.value}
          label={option.label}
          selected={value.includes(option.value)}
          onSelect={() => toggle(option.value)}
        />
      ))}
    </div>
  );
}
