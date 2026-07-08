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
import type { SessionExerciseRecord, SetRecordDTO } from "@kinora/contracts";
import type { WorkoutSetUpdateInput } from "../tracker-types";
import { WEIGHT_STEP, clamp, displayNum, parseLeadingInt } from "./tracker-model";
import type { Translate } from "./tracker-model";
import { Stepper } from "./Stepper";
import styles from "../TrackerPanel.module.css";

interface ExerciseCardProps {
  t: Translate;
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
  t,
  activeExercise,
  activeSet,
  currentSetNumber,
  totalSetsInExercise,
  exerciseVolume,
  canRecord,
  onRecordSet,
  onSetCompleted,
}: ExerciseCardProps) {
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

  const targetPill = t("tracker_target_pill", "Target · {reps} reps").replace(
    "{reps}",
    String(parseLeadingInt(activeSet?.targetReps, 0)),
  );

  return (
    <section
      className={`${styles.card} ${styles.exerciseCard}`}
      aria-label={t("tracker_current_exercise", "Current exercise")}
    >
      <div className={styles.exerciseTitleRow}>
        <div>
          <p className={styles.eyebrow}>{t("tracker_current_exercise", "Current exercise")}</p>
          <h2 className={styles.exerciseName}>{activeExercise?.title ?? "—"}</h2>
        </div>
        <span className={styles.targetPill}>{targetPill}</span>
      </div>

      <div className={styles.metricsGrid} aria-label={t("tracker_metrics_aria", "Exercise summary")}>
        <div className={styles.metric}>
          <span>{t("tracker_set_heading", "Set")}</span>
          <strong>
            {currentSetNumber}/{totalSetsInExercise}
          </strong>
        </div>
        <div className={styles.metric}>
          <span>{t("tracker_metric_volume", "Volume")}</span>
          <strong>
            {displayNum(Math.round(exerciseVolume))} {t("tracker_unit_kg", "kg")}
          </strong>
        </div>
        <div className={styles.metric}>
          <span>{t("tracker_rpe", "RPE")}</span>
          <strong>{activeSet?.rpe != null ? activeSet.rpe : "—"}</strong>
        </div>
      </div>

      <div className={styles.stepperGrid} role="group" aria-label={t("tracker_steppers_aria", "Adjust load and reps")}>
        <Stepper
          label={t("tracker_load_label", "Load")}
          labelId="tracker-load-label"
          value={displayNum(weight)}
          unit={t("tracker_unit_kg", "kg")}
          decrementLabel={t("tracker_weight_down_label", "Decrease load 2.5 kg")}
          incrementLabel={t("tracker_weight_up_label", "Increase load 2.5 kg")}
          onDecrement={() => setWeight((w) => clamp(+(w - WEIGHT_STEP).toFixed(1), 0, 300))}
          onIncrement={() => setWeight((w) => clamp(+(w + WEIGHT_STEP).toFixed(1), 0, 300))}
          disabled={!canRecord}
        />
        <Stepper
          label={t("tracker_reps_label", "Reps")}
          labelId="tracker-reps-label"
          value={reps}
          unit={t("tracker_unit_reps", "reps")}
          decrementLabel={t("tracker_reps_down_label", "Decrease reps")}
          incrementLabel={t("tracker_reps_up_label", "Increase reps")}
          onDecrement={() => setReps((r) => clamp(r - 1, 0, 99))}
          onIncrement={() => setReps((r) => clamp(r + 1, 0, 99))}
          disabled={!canRecord}
        />
      </div>

      <div className={styles.secondaryRow}>
        <div className={styles.rpeField}>
          <label className={styles.rpeLabel} htmlFor="tracker-rpe">
            {t("tracker_rpe", "RPE")}
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
            placeholder={t("tracker_note_placeholder", "Quick note")}
            aria-label={t("tracker_notes", "Notes")}
            disabled={!canRecord}
          />
        ) : (
          <button
            type="button"
            className={styles.btn}
            onClick={() => setShowNote(true)}
            disabled={!canRecord}
          >
            {t("tracker_add_note_cta", "Add note")}
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
          {t("tracker_complete_set_cta", "Complete set")}
        </button>
      </div>
    </section>
  );
}
