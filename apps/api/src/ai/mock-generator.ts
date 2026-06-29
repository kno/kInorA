import type { PlanSpec, WorkoutProgram, WorkoutSession, WorkoutExercise } from "@kinora/contracts";
import type { PlanGenerator } from "./port.js";

/** Default exercises used by the mock — one per session, no network needed. */
const MOCK_EXERCISES: WorkoutExercise[] = [
  { name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 },
  { name: "Bench Press", sets: 4, reps: "8-12", restSeconds: 90 },
  { name: "Deadlift", sets: 3, reps: "6-8", restSeconds: 120 },
  { name: "Overhead Press", sets: 3, reps: "8-12", restSeconds: 90 },
  { name: "Pull-Up", sets: 3, reps: "6-10", restSeconds: 90 },
  { name: "Romanian Deadlift", sets: 3, reps: "10-12", restSeconds: 90 },
  { name: "Dumbbell Row", sets: 3, reps: "10-12", restSeconds: 60 },
];

const SESSION_TITLES: string[] = [
  "Upper Body Strength",
  "Lower Body Strength",
  "Push Day",
  "Pull Day",
  "Full Body A",
  "Full Body B",
  "Active Recovery",
];

/**
 * Deterministic mock implementation of PlanGenerator.
 *
 * Returns a structurally valid WorkoutProgram without any network calls or
 * API keys. Used in all route/service tests (PR6+) that need a PlanGenerator
 * without involving real LLM infrastructure.
 *
 * Determinism guarantee: same spec → same output on every call, from any
 * instance. No random values, no timestamps, no external state.
 */
export class MockPlanGenerator implements PlanGenerator {
  async generate(spec: PlanSpec): Promise<WorkoutProgram> {
    const sessions: WorkoutSession[] = [];

    for (let day = 1; day <= spec.daysPerWeek; day++) {
      const exerciseIndex = (day - 1) % MOCK_EXERCISES.length;
      const titleIndex = (day - 1) % SESSION_TITLES.length;

      sessions.push({
        day,
        title: SESSION_TITLES[titleIndex] as string,
        exercises: [MOCK_EXERCISES[exerciseIndex] as WorkoutExercise],
      });
    }

    return {
      weeklySessions: sessions,
      limitationWarnings: [],
    };
  }
}
