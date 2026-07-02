"use client";

import { useState } from "react";
import type { TrainingLocation } from "@kinora/contracts";
import { OrbitSelectableCard } from "@/components/orbit";
import { KinIcon } from "@/components/icons/KinIcon";
import { equipmentForLocation, equipmentPhotoForValue } from "./options";
import styles from "./wizard.module.css";

export interface EquipmentStepProps {
  value?: string[];
  /** The location selected in the previous step — constrains the options. */
  location?: TrainingLocation;
  onSelect: (equipment: string[]) => void;
  messages?: Record<string, string>;
}

/**
 * Step 3 — available equipment. Multi-select, filtered by the chosen location,
 * plus free-text entries for gear that isn't in the static catalogue.
 *
 * Static options and manual entries share the one `string[]` the PlanSpec
 * carries. Static cards show an optional OpenDesign photo where the value maps
 * to one; values without a photo fall back to the OpenDesign `dumbbell` icon.
 * Manual entries are de-duplicated case-insensitively against both the current
 * selection and the static option values/labels. An empty selection remains
 * valid (the step is complete once visited).
 */
export function EquipmentStep({
  value = [],
  location,
  onSelect,
  messages = {},
}: EquipmentStepProps) {
  const t = (key: string, fallback: string): string => messages[key] ?? fallback;
  const options = equipmentForLocation(location);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = (item: string) => {
    if (value.includes(item)) {
      onSelect(value.filter((v) => v !== item));
    } else {
      onSelect([...value, item]);
    }
  };

  // Values that a manual entry must not collide with: everything already
  // selected, plus each static option's value and its display label.
  const reserved = new Set(
    [
      ...value,
      ...options.map((o) => o.value),
      ...options.map((o) => t(o.labelKey, o.labelFallback)),
    ].map((v) => v.toLowerCase()),
  );

  const addCustom = () => {
    const text = draft.trim();
    if (text === "") {
      setError(t("wizard_equipment_error_empty", "Enter an equipment name."));
      return;
    }
    if (reserved.has(text.toLowerCase())) {
      setError(
        t(
          "wizard_equipment_error_duplicate",
          "That equipment is already in your list.",
        ),
      );
      return;
    }
    setError(null);
    setDraft("");
    onSelect([...value, text]);
  };

  // Selected entries that are not part of the static catalogue → custom chips.
  const optionValues = new Set(options.map((o) => o.value));
  const customEntries = value.filter((v) => !optionValues.has(v));

  return (
    <div className={styles.stack}>
      <div className={styles.grid}>
        {options.map((option) => {
          const photo = equipmentPhotoForValue(option.value);
          // Photo-backed cards use the full-bleed media variant (image fills
          // the card, label overprinted, no checkmark — selection is the accent
          // border). Values without a photo keep the classic icon-box card.
          if (photo) {
            return (
              <OrbitSelectableCard
                key={option.value}
                label={t(option.labelKey, option.labelFallback)}
                selected={value.includes(option.value)}
                onSelect={() => toggle(option.value)}
                mediaBackground={
                  <img
                    src={photo.src}
                    alt={t(photo.altKey, photo.altFallback)}
                    width={294}
                    height={294}
                    loading="lazy"
                    className={styles.optionPhoto}
                  />
                }
              />
            );
          }
          return (
            <OrbitSelectableCard
              key={option.value}
              label={t(option.labelKey, option.labelFallback)}
              selected={value.includes(option.value)}
              onSelect={() => toggle(option.value)}
              icon={<KinIcon name="dumbbell" size={22} />}
            />
          );
        })}
      </div>

      <div className={styles.inputRow}>
        <input
          type="text"
          className={styles.input}
          aria-label={t("wizard_equipment_add_aria", "Add equipment")}
          placeholder={t("wizard_equipment_add_placeholder", "e.g. sled")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" className={styles.addButton} onClick={addCustom}>
          {t("wizard_equipment_add_button", "Add")}
        </button>
      </div>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {customEntries.length > 0 && (
        <ul className={styles.chips}>
          {customEntries.map((entry) => (
            <li key={entry} className={styles.chip}>
              {entry}
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={t("wizard_chip_remove_aria", "Remove {name}").replace(
                  "{name}",
                  entry,
                )}
                onClick={() => onSelect(value.filter((v) => v !== entry))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
