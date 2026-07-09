"use client";

import { useTranslations } from "next-intl";
import { OrbitSelectableCard } from "@/components/orbit";
import { FREQUENCY_OPTIONS } from "./options";
import styles from "./wizard.module.css";

export interface FrequencyStepProps {
  value?: number;
  onSelect: (daysPerWeek: number) => void;
}

/** Step 3 — weekly training frequency (daysPerWeek). */
export function FrequencyStep({ value, onSelect }: FrequencyStepProps) {
  const t = useTranslations();

  return (
    <div className={styles.grid}>
      {FREQUENCY_OPTIONS.map((days) => (
        <OrbitSelectableCard
          key={days}
          label={t("wizard.frequency.days", { n: days })}
          selected={value === days}
          onSelect={() => onSelect(days)}
        >
          {days >= 5
            ? t("wizard.frequency.highCommitment")
            : t("wizard.frequency.perWeek")}
        </OrbitSelectableCard>
      ))}
    </div>
  );
}
