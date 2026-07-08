/**
 * tracker-model — pure (React-free) derivations + formatters for the live
 * tracker. Keeping this logic out of the component makes it unit-testable in
 * isolation and keeps the presentational pieces thin.
 */

import type {
  SessionExerciseRecord,
  SetRecordDTO,
  WorkoutSessionRecord,
} from "@kinora/contracts";

/** Localized-string getter injected from the app's i18n (fallback-safe). */
export type Translate = (key: string, fallback: string) => string;

export const WEIGHT_STEP = 2.5;
export const RING_RADIUS = 66;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type ExerciseState = "done" | "active" | "pending";

export interface TimelineEntry {
  id: string;
  index: number;
  title: string;
  state: ExerciseState;
  setsCount: number;
  setsDone: number;
}

export interface TrackerModel {
  isCompleted: boolean;
  totalExercises: number;
  activeExercise?: SessionExerciseRecord;
  resolvedIndex: number;
  currentExerciseNumber: number;
  activeSet?: SetRecordDTO;
  currentSetNumber: number;
  totalSetsInExercise: number;
  nextExercise?: SessionExerciseRecord;
  totalSets: number;
  completedSets: number;
  percent: number;
  sessionVolume: number;
  activeExerciseVolume: number;
  /** Whether the current set can still be recorded. */
  canRecord: boolean;
  segments: Array<{ id: string; state: ExerciseState }>;
  timeline: TimelineEntry[];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Weights render as integers when whole, one decimal otherwise (45, 42.5). */
export function displayNum(value: number): string {
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

/** `targetReps` is a free string ("8", "8-10"); take its leading integer. */
export function parseLeadingInt(
  value: string | number | undefined,
  fallback: number,
): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string") return fallback;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

export function formatMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatRest(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function exerciseVolume(exercise: SessionExerciseRecord): number {
  return exercise.setRecords.reduce(
    (sum, set) => sum + (set.weightKg ?? 0) * (set.actualReps ?? 0),
    0,
  );
}

export function allSetsDone(exercise: SessionExerciseRecord): boolean {
  return (
    exercise.setRecords.length > 0 &&
    exercise.setRecords.every((set) => set.completed)
  );
}

function exerciseState(
  exercise: SessionExerciseRecord,
  index: number,
  resolvedIndex: number,
): ExerciseState {
  if (allSetsDone(exercise)) return "done";
  if (index === resolvedIndex) return "active";
  return "pending";
}

/**
 * Reduce a `WorkoutSessionRecord` to everything the presentational tracker
 * pieces need. The "active" exercise is the first with an incomplete set (or
 * the last exercise once every set is done); the "active" set is the first
 * incomplete set within it.
 */
export function deriveTrackerModel(session: WorkoutSessionRecord): TrackerModel {
  const exercises = session.exercises;
  const totalExercises = exercises.length;
  const isCompleted = session.status === "completed";

  const activeExerciseIndex = exercises.findIndex((ex) =>
    ex.setRecords.some((set) => !set.completed),
  );
  const resolvedIndex =
    activeExerciseIndex === -1 ? Math.max(0, totalExercises - 1) : activeExerciseIndex;
  const activeExercise = exercises[resolvedIndex];
  const currentExerciseNumber =
    activeExerciseIndex === -1 ? totalExercises : activeExerciseIndex + 1;

  const activeSetIndex = activeExercise
    ? activeExercise.setRecords.findIndex((set) => !set.completed)
    : -1;
  const activeSet = activeExercise
    ? activeSetIndex === -1
      ? activeExercise.setRecords[activeExercise.setRecords.length - 1]
      : activeExercise.setRecords[activeSetIndex]
    : undefined;
  const currentSetNumber =
    activeSetIndex === -1 ? (activeExercise?.setRecords.length ?? 0) : activeSetIndex + 1;
  const totalSetsInExercise = activeExercise?.setRecords.length ?? 0;

  const nextExercise = exercises[resolvedIndex + 1];

  const totalSets = exercises.reduce((n, ex) => n + ex.setRecords.length, 0);
  const completedSets = exercises.reduce(
    (n, ex) => n + ex.setRecords.filter((set) => set.completed).length,
    0,
  );
  const percent = totalSets === 0 ? 0 : Math.round((completedSets / totalSets) * 100);

  const sessionVolume = exercises.reduce((sum, ex) => sum + exerciseVolume(ex), 0);
  const activeExerciseVolume = activeExercise ? exerciseVolume(activeExercise) : 0;

  const canRecord =
    !isCompleted && !!activeExercise && !!activeSet && !allSetsDone(activeExercise);

  const segments = exercises.map((ex, i) => ({
    id: ex.id ?? String(i),
    state: exerciseState(ex, i, resolvedIndex),
  }));

  const timeline: TimelineEntry[] = exercises.map((ex, i) => ({
    id: ex.id ?? String(i),
    index: i + 1,
    title: ex.title,
    state: exerciseState(ex, i, resolvedIndex),
    setsCount: ex.setRecords.length,
    setsDone: ex.setRecords.filter((s) => s.completed).length,
  }));

  return {
    isCompleted,
    totalExercises,
    activeExercise,
    resolvedIndex,
    currentExerciseNumber,
    activeSet,
    currentSetNumber,
    totalSetsInExercise,
    nextExercise,
    totalSets,
    completedSets,
    percent,
    sessionVolume,
    activeExerciseVolume,
    canRecord,
    segments,
    timeline,
  };
}
