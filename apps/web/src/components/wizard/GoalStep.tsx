"use client";

import { useTranslations } from "next-intl";
import type { PlanGoal } from "@kinora/contracts";
import { OrbitSelectableCard } from "@/components/orbit";
import { GOAL_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface GoalStepProps {
  value?: PlanGoal;
  onSelect: (goal: PlanGoal) => void;
}

/** Step 1 — the user's primary training goal. */
export function GoalStep({ value, onSelect }: GoalStepProps) {
  const t = useTranslations();

  return (
    <div className={styles.grid}>
      {GOAL_OPTIONS.map((option) => (
        <OrbitSelectableCard
          key={option.value}
          label={t(option.labelKey)}
          selected={value === option.value}
          onSelect={() => onSelect(option.value)}
        >
          {t(option.descriptionKey)}
        </OrbitSelectableCard>
      ))}
    </div>
  );
}
