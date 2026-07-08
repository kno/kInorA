/**
 * Pure, framework-free logic for the workout tracker screen.
 *
 * Following the mobile app's established pattern (see `session-guard.ts`,
 * `credentials.ts`): all branching / math lives in pure functions that are
 * unit-tested, and the React screen is thin glue over them. No React Native
 * imports here.
 */

import type {
  SessionExerciseRecord,
  SetRecordDTO,
  WorkoutSessionRecord,
} from "@kinora/contracts";

/** Weight stepper increment (kg), matching the design's ±2.5. */
export const WEIGHT_STEP = 2.5;
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 300;
export const REPS_MIN = 1;
export const REPS_MAX = 99;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Elapsed session timer format — zero-padded minutes, e.g. `23:47`. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Rest countdown format — non-padded minutes, e.g. `1:30`. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Whole seconds elapsed since an ISO timestamp (never negative). */
export function elapsedSecondsSince(startedAtIso: string, nowMs: number): number {
  const startMs = Date.parse(startedAtIso);
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

/** Step the weight by ±WEIGHT_STEP, clamped, normalized to at most 1 decimal. */
export function stepWeight(current: number, direction: 1 | -1): number {
  const next = current + direction * WEIGHT_STEP;
  return clamp(Number(next.toFixed(1)), WEIGHT_MIN, WEIGHT_MAX);
}

/** Step reps by ±1, clamped. */
export function stepReps(current: number, direction: 1 | -1): number {
  return clamp(Math.round(current) + direction, REPS_MIN, REPS_MAX);
}

/** Render a weight as an integer when whole, otherwise 1 decimal. */
export function formatWeight(weight: number): string {
  return weight % 1 === 0 ? String(weight) : weight.toFixed(1);
}

/**
 * Parse the first integer out of a target-reps string (`"8"`, `"8-10"`,
 * `"AMRAP"`). Falls back to `fallback` when no digits are present.
 */
export function parseTargetReps(targetReps: string, fallback = 8): number {
  const match = targetReps.match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

/** Order a session's exercises by their declared index (defensive copy). */
function orderedExercises(
  session: WorkoutSessionRecord,
): SessionExerciseRecord[] {
  return [...session.exercises].sort(
    (a, b) => a.exerciseIndex - b.exerciseIndex,
  );
}

/** Order an exercise's sets by their declared index (defensive copy). */
export function orderedSets(exercise: SessionExerciseRecord): SetRecordDTO[] {
  return [...exercise.setRecords].sort((a, b) => a.setIndex - b.setIndex);
}

export interface SeedValues {
  weightKg: number;
  reps: number;
}

/**
 * Seed the steppers for a set: prefer its own recorded values, then the
 * target reps, with sensible defaults so the stepper never starts empty.
 */
export function seedFromSet(set: SetRecordDTO, defaultWeight = 20): SeedValues {
  return {
    weightKg: set.weightKg ?? defaultWeight,
    reps: set.actualReps ?? parseTargetReps(set.targetReps),
  };
}

export interface TrackerView {
  exerciseCount: number;
  /** 1-based position of the current exercise, or exerciseCount when done. */
  currentExerciseNumber: number;
  totalSets: number;
  completedSets: number;
  /** 0-100, rounded. */
  percent: number;
  currentExercise?: SessionExerciseRecord;
  currentSet?: SetRecordDTO;
  /** 1-based position of the current set within its exercise. */
  currentSetNumber: number;
  setsInCurrentExercise: number;
  nextExercise?: SessionExerciseRecord;
  /** No incomplete sets remain (or the server marked the session completed). */
  isComplete: boolean;
}

/**
 * Derive everything the tracker screen renders from a session snapshot.
 *
 * "Current" = the first set that is not yet completed, scanning exercises in
 * order. Progress percent is completed-sets / total-sets so partial-exercise
 * progress is reflected. `nextExercise` is the one after the current exercise,
 * used for the "A continuación" preview.
 */
export function deriveTrackerView(session: WorkoutSessionRecord): TrackerView {
  const exercises = orderedExercises(session);
  const exerciseCount = exercises.length;

  let totalSets = 0;
  let completedSets = 0;
  for (const ex of exercises) {
    for (const set of ex.setRecords) {
      totalSets += 1;
      if (set.completed) completedSets += 1;
    }
  }

  let currentExercise: SessionExerciseRecord | undefined;
  let currentSet: SetRecordDTO | undefined;
  let currentExerciseIndex = -1;
  let currentSetNumber = 0;
  let setsInCurrentExercise = 0;

  for (let i = 0; i < exercises.length; i += 1) {
    const ex = exercises[i];
    if (!ex) continue;
    const sets = orderedSets(ex);
    const pendingIndex = sets.findIndex((s) => !s.completed);
    if (pendingIndex !== -1) {
      currentExercise = ex;
      currentSet = sets[pendingIndex];
      currentExerciseIndex = i;
      currentSetNumber = pendingIndex + 1;
      setsInCurrentExercise = sets.length;
      break;
    }
  }

  const isComplete =
    session.status === "completed" || currentExercise === undefined;

  const nextExercise =
    currentExerciseIndex >= 0 && currentExerciseIndex + 1 < exercises.length
      ? exercises[currentExerciseIndex + 1]
      : undefined;

  const currentExerciseNumber =
    currentExerciseIndex >= 0 ? currentExerciseIndex + 1 : exerciseCount;

  const percent =
    totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;

  return {
    exerciseCount,
    currentExerciseNumber,
    totalSets,
    completedSets,
    percent,
    currentExercise,
    currentSet,
    currentSetNumber,
    setsInCurrentExercise,
    nextExercise,
    isComplete,
  };
}

export type SegmentState = "done" | "active" | "pending";

/**
 * Per-exercise segment states for the segmented progress bar: an exercise is
 * `done` when all its sets are completed, `active` when it is the current
 * exercise (has pending sets and is the first such), else `pending`.
 */
export function segmentStates(session: WorkoutSessionRecord): SegmentState[] {
  const exercises = orderedExercises(session);
  const view = deriveTrackerView(session);
  const activeId = view.currentExercise?.id;
  return exercises.map((ex) => {
    const allDone =
      ex.setRecords.length > 0 && ex.setRecords.every((s) => s.completed);
    if (allDone) return "done";
    if (ex.id === activeId) return "active";
    return "pending";
  });
}

/**
 * SVG ring `stroke-dashoffset` for a countdown: 0 when full, full
 * circumference when empty.
 */
export function ringDashoffset(
  remaining: number,
  duration: number,
  circumference: number,
): number {
  if (duration <= 0) return 0;
  const fraction = clamp(remaining / duration, 0, 1);
  return Number((circumference * (1 - fraction)).toFixed(2));
}
