"use client";

/**
 * ExerciseCard — the current-exercise workbench: target pill, metrics, the
 * load/reps steppers, an optional RPE + note, and the "Complete set" CTA.
 *
 * Owns the draft state for the CURRENT set only (weight/reps/rpe/note),
 * re-seeded whenever the active set changes. Recording is delegated to
 * `onRecordSet`; `onSetCompleted` lets the parent kick off the rest timer.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { SessionExerciseRecord, SetRecordDTO } from "@kinora/contracts";
import type { WorkoutSetUpdateInput } from "../tracker-types";
import { WEIGHT_STEP, clamp, displayNum, parseLeadingInt } from "./tracker-model";
import { Stepper } from "./Stepper";
import styles from "../TrackerPanel.module.css";

interface ExerciseCardProps {
  activeExercise?: SessionExerciseRecord;
  activeSet?: SetRecordDTO;
  currentSetNumber: number;
  totalSetsInExercise: number;
  exerciseVolume: number;
  canRecord: boolean;
  onRecordSet: (setId: string, input: WorkoutSetUpdateInput) => Promise<void>;
  onSetCompleted: () => void;
}

function seedFromSet(set: SetRecordDTO | undefined) {
  return {
    weight: set?.weightKg ?? 0,
    reps: set?.actualReps ?? parseLeadingInt(set?.targetReps, 0),
    rpe: set?.rpe != null ? String(set.rpe) : "",
    note: set?.notes ?? "",
  };
}

export function ExerciseCard({
  activeExercise,
  activeSet,
  currentSetNumber,
  totalSetsInExercise,
  exerciseVolume,
  canRecord,
  onRecordSet,
  onSetCompleted,
}: ExerciseCardProps) {
  const t = useTranslations("tracker");
  const [weight, setWeight] = useState(() => seedFromSet(activeSet).weight);
  const [reps, setReps] = useState(() => seedFromSet(activeSet).reps);
  const [rpeInput, setRpeInput] = useState(() => seedFromSet(activeSet).rpe);
  const [note, setNote] = useState(() => seedFromSet(activeSet).note);
  const [showNote, setShowNote] = useState(false);
  const activeSetId = activeSet?.id;

  useEffect(() => {
    const seed = seedFromSet(activeSet);
    setWeight(seed.weight);
    setReps(seed.reps);
    setRpeInput(seed.rpe);
    setNote(seed.note);
    // Re-seed only when the identity of the active set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSetId]);

  const handleCompleteSet = useCallback(async () => {
    if (!activeSet) return;
    const parsedRpe = rpeInput.trim() === "" ? undefined : Number(rpeInput);
    const trimmedNote = note.trim();
    await onRecordSet(activeSet.id, {
      completed: true,
      weightKg: weight,
      actualReps: reps,
      rpe:
        parsedRpe != null && Number.isFinite(parsedRpe)
          ? clamp(parsedRpe, 0, 10)
          : undefined,
      notes: trimmedNote === "" ? undefined : trimmedNote,
    });
    onSetCompleted();
  }, [activeSet, rpeInput, note, weight, reps, onRecordSet, onSetCompleted]);

  const targetPill = t("target.pill", { reps: parseLeadingInt(activeSet?.targetReps, 0) });

  return (
    <section
      className={`${styles.card} ${styles.exerciseCard}`}
      aria-label={t("currentExercise")}
    >
      <div className={styles.exerciseTitleRow}>
        <div>
          <p className={styles.eyebrow}>{t("currentExercise")}</p>
          <h2 className={styles.exerciseName}>{activeExercise?.title ?? "—"}</h2>
        </div>
        <span className={styles.targetPill}>{targetPill}</span>
      </div>

      <div className={styles.metricsGrid} aria-label={t("metrics.aria")}>
        <div className={styles.metric}>
          <span>{t("set.heading")}</span>
          <strong>
            {currentSetNumber}/{totalSetsInExercise}
          </strong>
        </div>
        <div className={styles.metric}>
          <span>{t("metric.volume")}</span>
          <strong>
            {displayNum(Math.round(exerciseVolume))} {t("unit.kg")}
          </strong>
        </div>
        <div className={styles.metric}>
          <span>{t("rpe")}</span>
          <strong>{activeSet?.rpe != null ? activeSet.rpe : "—"}</strong>
        </div>
      </div>

      <div className={styles.stepperGrid} role="group" aria-label={t("steppers.aria")}>
        <Stepper
          label={t("load.label")}
          labelId="tracker-load-label"
          value={displayNum(weight)}
          unit={t("unit.kg")}
          decrementLabel={t("weight.downLabel")}
          incrementLabel={t("weight.upLabel")}
          onDecrement={() => setWeight((w) => clamp(+(w - WEIGHT_STEP).toFixed(1), 0, 300))}
          onIncrement={() => setWeight((w) => clamp(+(w + WEIGHT_STEP).toFixed(1), 0, 300))}
          disabled={!canRecord}
        />
        <Stepper
          label={t("reps.label")}
          labelId="tracker-reps-label"
          value={reps}
          unit={t("unit.reps")}
          decrementLabel={t("reps.downLabel")}
          incrementLabel={t("reps.upLabel")}
          onDecrement={() => setReps((r) => clamp(r - 1, 0, 99))}
          onIncrement={() => setReps((r) => clamp(r + 1, 0, 99))}
          disabled={!canRecord}
        />
      </div>

      <div className={styles.secondaryRow}>
        <div className={styles.rpeField}>
          <label className={styles.rpeLabel} htmlFor="tracker-rpe">
            {t("rpe")}
          </label>
          <input
            id="tracker-rpe"
            className={styles.rpeInput}
            type="number"
            min={0}
            max={10}
            step="1"
            inputMode="numeric"
            value={rpeInput}
            onChange={(e) => setRpeInput(e.target.value)}
            disabled={!canRecord}
          />
        </div>
        {showNote ? (
          <textarea
            className={styles.noteInput}
            rows={1}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("note.placeholder")}
            aria-label={t("notes")}
            disabled={!canRecord}
          />
        ) : (
          <button
            type="button"
            className={styles.btn}
            onClick={() => setShowNote(true)}
            disabled={!canRecord}
          >
            {t("addNote.cta")}
          </button>
        )}
      </div>

      <div className={styles.completeRow}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleCompleteSet}
          disabled={!canRecord}
        >
          {t("completeSet.cta")}
        </button>
      </div>
    </section>
  );
}
