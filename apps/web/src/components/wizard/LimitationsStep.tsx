"use client";

import { useState } from "react";
import type { PlanLimitation } from "@kinora/contracts";
import styles from "./wizard.module.css";

export interface LimitationsStepProps {
  value?: PlanLimitation[];
  onSelect: (limitations: PlanLimitation[]) => void;
}

/**
 * Step 6 — free-text limitations. Each entry is stored as
 * `{ text, isWarning: true }`; no medical diagnosis is attempted. An empty
 * list is valid (the step is complete once visited).
 */
export function LimitationsStep({ value = [], onSelect }: LimitationsStepProps) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onSelect([...value, { text, isWarning: true }]);
    setDraft("");
  };

  return (
    <div className={styles.stack}>
      <div className={styles.inputRow}>
        <input
          type="text"
          className={styles.input}
          aria-label="Add a limitation"
          placeholder="e.g. knee pain"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={styles.addButton} onClick={add}>
          Add
        </button>
      </div>

      {value.length > 0 && (
        <ul className={styles.chips}>
          {value.map((limitation, index) => (
            <li key={`${limitation.text}-${index}`} className={styles.chip}>
              {limitation.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
