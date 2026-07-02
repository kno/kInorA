"use client";

import type { PlanGoal } from "@kinora/contracts";
import { OrbitSelectableCard } from "@/components/orbit";
import { GOAL_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface GoalStepProps {
  value?: PlanGoal;
  onSelect: (goal: PlanGoal) => void;
  messages?: Record<string, string>;
}

/** Step 1 — the user's primary training goal. */
export function GoalStep({ value, onSelect, messages = {} }: GoalStepProps) {
  const t = (key: string, fallback: string): string => messages[key] ?? fallback;

  return (
    <div className={styles.grid}>
      {GOAL_OPTIONS.map((option) => (
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
