"use client";

import { useState } from "react";
import type { TrainingLocation } from "@kinora/contracts";
import { OrbitSelectableCard } from "@/components/orbit";
import { KinIcon } from "@/components/icons/KinIcon";
import { equipmentForLocation } from "./options";
import styles from "./wizard.module.css";

export interface EquipmentStepProps {
  value?: string[];
  /** The location selected in the previous step — constrains the options. */
  location?: TrainingLocation;
  onSelect: (equipment: string[]) => void;
}

/**
 * Step 5 — available equipment. Multi-select, filtered by the chosen location,
 * plus free-text entries for gear that isn't in the static catalogue.
 *
 * Static options and manual entries share the one `string[]` the PlanSpec
 * carries. Static cards use the OpenDesign `dumbbell` icon rather than new
 * imagery. Manual entries are de-duplicated case-insensitively against both
 * the current selection and the static option values/labels. An empty
 * selection remains valid (the step is complete once visited).
 */
export function EquipmentStep({ value = [], location, onSelect }: EquipmentStepProps) {
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
      ...options.map((o) => o.label),
    ].map((v) => v.toLowerCase()),
  );

  const addCustom = () => {
    const text = draft.trim();
    if (text === "") {
      setError("Enter an equipment name.");
      return;
    }
    if (reserved.has(text.toLowerCase())) {
      setError("That equipment is already in your list.");
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
        {options.map((option) => (
          <OrbitSelectableCard
            key={option.value}
            label={option.label}
            selected={value.includes(option.value)}
            onSelect={() => toggle(option.value)}
            icon={<KinIcon name="dumbbell" size={22} />}
          />
        ))}
      </div>

      <div className={styles.inputRow}>
        <input
          type="text"
          className={styles.input}
          aria-label="Add equipment"
          placeholder="e.g. sled"
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
          Add
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
                aria-label={`Remove ${entry}`}
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
