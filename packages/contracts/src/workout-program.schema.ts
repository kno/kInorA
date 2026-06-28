import { z } from "zod";

/**
 * Zod schema for WorkoutExercise.
 * Used by `.withStructuredOutput(WorkoutProgramSchema)` in the OpenRouter adapter.
 */
const WorkoutExerciseSchema = z.object({
  name: z.string(),
  sets: z.number().int().positive(),
  /** Rep range or count expressed as a string (e.g. "8-12" or "15"). */
  reps: z.string(),
  restSeconds: z.number().int().nonnegative(),
  notes: z.string().optional(),
  substitutionNote: z.string().optional(),
});

/**
 * Zod schema for WorkoutSession.
 */
const WorkoutSessionSchema = z.object({
  /** Day number within the week (1-based). */
  day: z.number().int().positive(),
  title: z.string(),
  exercises: z.array(WorkoutExerciseSchema),
});

/**
 * Zod schema for WorkoutProgram.
 * Mirrors the TypeScript interfaces in index.ts.
 * Forward-compatible with 09a (session/exercise/planned-set tracking).
 */
export const WorkoutProgramSchema = z.object({
  /** One session per training day; length equals daysPerWeek from PlanSpec. */
  weeklySessions: z.array(WorkoutSessionSchema),
  limitationWarnings: z.array(z.string()),
});

export type WorkoutProgramSchemaType = z.infer<typeof WorkoutProgramSchema>;
