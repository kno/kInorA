import type { WorkoutProgram, WorkoutExercise } from "@kinora/contracts";

/**
 * Bodyweight substitution map.
 *
 * Maps a known equipment-dependent exercise name (lowercase) to its
 * bodyweight or minimal-equipment alternative.
 *
 * Keys are lowercase exercise names as they may appear in a generated plan.
 * This is a curated first-pass list covering the most common gym exercises.
 */
const SUBSTITUTION_MAP: Record<string, string> = {
  // Chest
  "barbell bench press": "push-up",
  "dumbbell bench press": "push-up",
  "dumbbell fly": "push-up",
  "cable fly": "push-up",
  "chest press machine": "push-up",

  // Back
  "barbell row": "inverted row",
  "dumbbell row": "inverted row",
  "lat pulldown": "pull-up",
  "cable row": "inverted row",
  "seated cable row": "inverted row",

  // Shoulders
  "barbell overhead press": "pike push-up",
  "dumbbell shoulder press": "pike push-up",
  "dumbbell lateral raise": "arm circle",
  "cable lateral raise": "arm circle",
  "barbell upright row": "pike push-up",

  // Arms
  "barbell bicep curl": "resistance band curl",
  "dumbbell bicep curl": "resistance band curl",
  "cable bicep curl": "resistance band curl",
  "barbell skullcrusher": "diamond push-up",
  "dumbbell tricep extension": "diamond push-up",
  "cable tricep pushdown": "diamond push-up",

  // Legs
  "barbell squat": "bodyweight squat",
  "dumbbell squat": "bodyweight squat",
  "barbell deadlift": "glute bridge",
  "dumbbell deadlift": "glute bridge",
  "leg press": "bodyweight squat",
  "leg curl": "nordic curl",
  "leg extension": "wall sit",
  "barbell lunge": "bodyweight lunge",
  "dumbbell lunge": "bodyweight lunge",
  "dumbbell step-up": "bodyweight step-up",
  "barbell hip thrust": "glute bridge",
  "dumbbell hip thrust": "glute bridge",

  // Core (typically bodyweight already, but include weighted variants)
  "cable crunch": "crunch",
  "weighted sit-up": "sit-up",
  "dumbbell side bend": "side plank",
};

/**
 * Looks up the bodyweight substitute for a given exercise name.
 * Matching is case-insensitive.
 *
 * @returns The substitute name or undefined if no substitution exists.
 */
function findSubstitute(exerciseName: string): string | undefined {
  return SUBSTITUTION_MAP[exerciseName.toLowerCase()];
}

/**
 * Substitutes a single exercise with its bodyweight alternative (if any).
 * Returns a new exercise object — never mutates the input.
 */
function substituteExercise(exercise: WorkoutExercise): WorkoutExercise {
  const substitute = findSubstitute(exercise.name);
  if (!substitute) return exercise;

  return {
    ...exercise,
    name: substitute,
    substitutionNote: `Substituted from "${exercise.name}" (equipment unavailable) → "${substitute}"`,
  };
}

/**
 * Applies bodyweight substitutions to all exercises in the program when the
 * user does not have the required equipment.
 *
 * Pure function — input program is never mutated.
 *
 * If `equipment` is non-empty, the program is returned as-is: we trust the LLM
 * to have generated appropriate exercises for the given equipment. Substitution
 * is only applied when the user declares no equipment (bodyweight-only context).
 *
 * @param program   The generated workout program.
 * @param equipment The list of equipment the user has available.
 * @returns         A new WorkoutProgram with substitutions applied (or the
 *                  original program reference when no substitutions are needed).
 */
export function applyEquipmentSubstitutions(
  program: WorkoutProgram,
  equipment: string[],
): WorkoutProgram {
  // No substitution needed when the user has equipment
  if (equipment.length > 0) return program;

  return {
    ...program,
    weeklySessions: program.weeklySessions.map((session) => ({
      ...session,
      exercises: session.exercises.map(substituteExercise),
    })),
  };
}
