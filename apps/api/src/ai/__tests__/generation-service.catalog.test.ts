/**
 * End-to-end wiring of the catalog constraint through the generation pipeline
 * (#352 slice B): the vocabulary reaches the generator as a closed list, and the
 * program that reaches `markReady` carries the resolved ids.
 *
 * The assertions deliberately look at what is PERSISTED rather than at the
 * service's return value — `startGeneration` returns before the background task
 * runs, so persistence is the only place the linking is observable, and it is
 * the only place it matters.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";

import { PlanGenerationService } from "../generation-service.js";
import { PROMPT_VOCABULARY_CAP, resolveExerciseVocabulary } from "../exercise-vocabulary.js";
import type { ObservabilityLogger } from "../../observability/event-logger.js";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const USER = "aaaaaaaa-0000-0000-0000-000000000002";
const SPEC_ID = "spec-uuid-1";
const PLAN_ID = "plan-uuid-1";

const PUSH_UP_ID = "0662";

const bodyweightSpec: PlanSpec = {
  goal: "hypertrophy",
  daysPerWeek: 1,
  sessionDurationMinutes: 45,
  location: "home",
  equipment: ["bodyweight"],
  limitations: [],
  preferenceScores: { strength: 0.4, hypertrophy: 0.8, endurance: 0.3, mobility: 0.3 },
  confirmed: true,
};

function programOf(...names: string[]): WorkoutProgram {
  return {
    weeklySessions: [
      {
        day: 1,
        title: "Full Body A",
        exercises: names.map((name) => ({ name, sets: 3, reps: "8-12", restSeconds: 60 })),
      },
    ],
    limitationWarnings: [],
  };
}

function buildPlanRepo() {
  return {
    createGenerating: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "generating" as const }),
    markReady: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "ready" }),
    markFailed: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "failed" }),
  };
}

interface Harness {
  generator: { generate: ReturnType<typeof vi.fn> };
  planRepo: ReturnType<typeof buildPlanRepo>;
  logger: ObservabilityLogger & { recordEvent: ReturnType<typeof vi.fn> };
  service: PlanGenerationService;
}

function harness(program: WorkoutProgram, spec: PlanSpec = bodyweightSpec): Harness {
  const generator = { generate: vi.fn().mockResolvedValue(program) };
  const planRepo = buildPlanRepo();
  const logger = { recordEvent: vi.fn() };
  const specRepo = { findConfirmedById: vi.fn().mockResolvedValue({ specJson: spec }) };

  return {
    generator,
    planRepo,
    logger,
    service: new PlanGenerationService(
      generator as never,
      specRepo as never,
      planRepo as never,
      undefined,
      undefined,
      undefined,
      logger,
    ),
  };
}

/** The program handed to markReady, once the background task has run. */
async function persistedProgram(h: Harness): Promise<WorkoutProgram> {
  await vi.waitFor(() => expect(h.planRepo.markReady).toHaveBeenCalled());
  return h.planRepo.markReady.mock.calls[0]![2] as WorkoutProgram;
}

function eventsNamed(h: Harness, event: string): Record<string, unknown>[] {
  return h.logger.recordEvent.mock.calls
    .map(([arg]) => arg as Record<string, unknown>)
    .filter((arg) => arg.event === event);
}

describe("PlanGenerationService — catalog vocabulary in the prompt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hands the generator the user's equipment-filtered exercise names", async () => {
    const h = harness(programOf("push-up"));
    await h.service.startGeneration(TENANT, USER, SPEC_ID);
    await persistedProgram(h);

    const input = h.generator.generate.mock.calls[0]![0] as { allowedExercises: string[] };
    expect(input.allowedExercises).toContain("push-up");
    // Needs a bar the bodyweight-only user does not have.
    expect(input.allowedExercises).not.toContain("pull-up");
  });

  it("caps the list and records what the prompt budget dropped", async () => {
    const fullGym: PlanSpec = {
      ...bodyweightSpec,
      equipment: ["barbell", "dumbbells", "cable_machine", "bench", "pull_up_bar"],
    };
    const h = harness(programOf("push-up"), fullGym);
    await h.service.startGeneration(TENANT, USER, SPEC_ID);
    await persistedProgram(h);

    const input = h.generator.generate.mock.calls[0]![0] as { allowedExercises: string[] };
    expect(input.allowedExercises).toHaveLength(PROMPT_VOCABULARY_CAP);

    const full = resolveExerciseVocabulary(fullGym.equipment).exercises.length;
    const [event] = eventsNamed(h, "generation.vocabulary");
    expect(event).toMatchObject({
      level: "warn",
      metadata: {
        planId: PLAN_ID,
        planSpecId: SPEC_ID,
        vocabularySize: full,
        promptSize: PROMPT_VOCABULARY_CAP,
        droppedCount: full - PROMPT_VOCABULARY_CAP,
      },
    });
  });

  it("reports an equipment answer that unlocked nothing", async () => {
    const h = harness(programOf("push-up"), {
      ...bodyweightSpec,
      equipment: ["bodyweight", "suspension_trainer"],
    });
    await h.service.startGeneration(TENANT, USER, SPEC_ID);
    await persistedProgram(h);

    const [event] = eventsNamed(h, "generation.vocabulary");
    expect((event?.metadata as Record<string, unknown>).ignoredEquipment).toBe(
      "suspension_trainer",
    );
  });
});

describe("PlanGenerationService — catalog ids on the persisted program", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists the catalogId of an exercise inside the vocabulary", async () => {
    const h = harness(programOf("push-up"));
    await h.service.startGeneration(TENANT, USER, SPEC_ID);

    const program = await persistedProgram(h);
    expect(program.weeklySessions[0]?.exercises[0]?.catalogId).toBe(PUSH_UP_ID);
  });

  it("persists no catalogId for an exercise outside the vocabulary", async () => {
    const h = harness(programOf("Interstellar Thruster Complex"));
    await h.service.startGeneration(TENANT, USER, SPEC_ID);

    const program = await persistedProgram(h);
    expect(program.weeklySessions[0]?.exercises[0]).not.toHaveProperty("catalogId");
  });

  it("never rewrites the free-text name — resolved or not", async () => {
    const h = harness(programOf("Push-Ups", "Interstellar Thruster Complex"));
    await h.service.startGeneration(TENANT, USER, SPEC_ID);

    const program = await persistedProgram(h);
    const exercises = program.weeklySessions[0]?.exercises ?? [];
    expect(exercises.map((e) => e.name)).toEqual([
      "Push-Ups",
      "Interstellar Thruster Complex",
    ]);
    // The resolved one carries the catalog's id but keeps the prescription's
    // spelling — the catalog's own name is "push-up".
    expect(exercises[0]?.catalogId).toBe(PUSH_UP_ID);
  });

  it("still marks the plan ready when an exercise cannot be resolved", async () => {
    // Accept-and-flag, not reject-and-retry: a regeneration would spend another
    // metered unit to fix one missing link.
    const h = harness(programOf("Interstellar Thruster Complex"));
    await h.service.startGeneration(TENANT, USER, SPEC_ID);

    await persistedProgram(h);
    expect(h.planRepo.markFailed).not.toHaveBeenCalled();
    expect(h.generator.generate).toHaveBeenCalledTimes(1);
  });
});

describe("PlanGenerationService — unresolved-exercise observability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records one warn event per miss, carrying the name and its position", async () => {
    const h = harness(programOf("push-up", "Interstellar Thruster Complex"));
    await h.service.startGeneration(TENANT, USER, SPEC_ID);
    await persistedProgram(h);

    const misses = eventsNamed(h, "generation.exercise_unresolved");
    expect(misses).toHaveLength(1);
    expect(misses[0]).toEqual({
      tenantId: TENANT,
      level: "warn",
      event: "generation.exercise_unresolved",
      outcome: "no_match",
      metadata: {
        planId: PLAN_ID,
        planSpecId: SPEC_ID,
        exerciseName: "Interstellar Thruster Complex",
        day: 1,
        exerciseIndex: 1,
      },
    });
  });

  it("distinguishes an out-of-vocabulary catalog exercise from an invented one", async () => {
    const h = harness(programOf("dumbbell bench press"));
    await h.service.startGeneration(TENANT, USER, SPEC_ID);
    await persistedProgram(h);

    expect(eventsNamed(h, "generation.exercise_unresolved")[0]?.outcome).toBe(
      "out_of_vocabulary",
    );
  });

  it("records no miss event when everything resolves", async () => {
    const h = harness(programOf("push-up", "burpee"));
    await h.service.startGeneration(TENANT, USER, SPEC_ID);
    await persistedProgram(h);

    expect(eventsNamed(h, "generation.exercise_unresolved")).toEqual([]);
    expect(eventsNamed(h, "generation.catalog_resolution")[0]).toMatchObject({
      metadata: { resolvedCount: 2, unresolvedCount: 0 },
    });
  });

  it("keeps the PII invariant: no sets, reps, notes or session title are logged", async () => {
    const program: WorkoutProgram = {
      weeklySessions: [
        {
          day: 1,
          title: "Secret Session Title",
          exercises: [
            {
              name: "Interstellar Thruster Complex",
              sets: 3,
              reps: "8-12",
              restSeconds: 60,
              notes: "confidential coaching note",
            },
          ],
        },
      ],
      limitationWarnings: [],
    };
    const h = harness(program);
    await h.service.startGeneration(TENANT, USER, SPEC_ID);
    await persistedProgram(h);

    const logged = JSON.stringify(h.logger.recordEvent.mock.calls);
    expect(logged).not.toContain("Secret Session Title");
    expect(logged).not.toContain("confidential coaching note");
  });

  it("works without an observability logger", async () => {
    const generator = { generate: vi.fn().mockResolvedValue(programOf("push-up")) };
    const planRepo = buildPlanRepo();
    const service = new PlanGenerationService(
      generator as never,
      { findConfirmedById: vi.fn().mockResolvedValue({ specJson: bodyweightSpec }) } as never,
      planRepo as never,
    );

    await service.startGeneration(TENANT, USER, SPEC_ID);

    await vi.waitFor(() => expect(planRepo.markReady).toHaveBeenCalled());
    const program = planRepo.markReady.mock.calls[0]![2] as WorkoutProgram;
    expect(program.weeklySessions[0]?.exercises[0]?.catalogId).toBe(PUSH_UP_ID);
  });
});
