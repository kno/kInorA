"use client";

import { useTranslations } from "next-intl";
import type { TrainingLocation } from "@kinora/contracts";
import { DurationStep } from "./DurationStep";
import { EquipmentStep } from "./EquipmentStep";
import { LocationStep } from "./LocationStep";
import styles from "./wizard.module.css";

export interface PreferencesStepValue {
  defaultLocation: TrainingLocation | null;
  defaultDuration: number | null;
  defaultEquipment: string[] | null;
}

export interface PreferencesStepProps {
  value: PreferencesStepValue;
  onChange: (next: PreferencesStepValue) => void;
}

export function PreferencesStep({ value, onChange }: PreferencesStepProps) {
  const t = useTranslations();

  return (
    <div className={styles.stack}>
      <section className={styles.section}>
        <p className={styles.sectionTitle}>{t("wizard.preferences.locationLabel")}</p>
        <LocationStep
          value={value.defaultLocation ?? undefined}
          onSelect={(defaultLocation) => onChange({ ...value, defaultLocation })}
        />
      </section>

      <section className={styles.section}>
        <p className={styles.sectionTitle}>{t("wizard.preferences.durationLabel")}</p>
        <DurationStep
          value={value.defaultDuration ?? undefined}
          onSelect={(defaultDuration) => onChange({ ...value, defaultDuration })}
        />
      </section>

      <section className={styles.section}>
        <p className={styles.sectionTitle}>{t("wizard.preferences.equipmentLabel")}</p>
        <EquipmentStep
          location={value.defaultLocation ?? undefined}
          value={value.defaultEquipment ?? []}
          onSelect={(defaultEquipment) => onChange({ ...value, defaultEquipment })}
        />
      </section>
    </div>
  );
}
