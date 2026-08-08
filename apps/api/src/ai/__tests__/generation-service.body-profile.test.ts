import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";
import { PlanGenerationService } from "../generation-service.js";

/**
 * 17c-profile-body-metrics, PR 3 — `PlanGenerationService.attachBodyProfile`.
 *
 * Proves the mapping from the profile row + weight series into
 * `BodyProfilePromptInput`, and — critically — that `prefer_not_to_say`
 * never reaches the generator, and that the whole feature is a no-op
 * (byte-identical `generate()` call) when neither source is injected, which
 * is the shape every EXISTING test in this suite already exercises.
 */

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000010";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SPEC_ID = "spec-uuid-1";
const PLAN_ID = "plan-uuid-1";

const confirmedSpec: PlanSpec = {
  goal: "strength",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: { strength: 0.8, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
  confirmed: true,
};

function workoutProgram(): WorkoutProgram {
  return {
    weeklySessions: [
      { day: 1, title: "Generated plan", exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }] },
    ],
    limitationWarnings: [],
  };
}

function buildService(
  generator: { generate: ReturnType<typeof vi.fn> },
  userProfileSource?: { findByUserId: ReturnType<typeof vi.fn> },
  weightEntrySource?: { list: ReturnType<typeof vi.fn> },
) {
  const specRepo = {
    findConfirmedById: vi.fn().mockResolvedValue({ specJson: confirmedSpec }),
  };
  const planRepo = {
    createGenerating: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "generating" }),
    markReady: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "ready" }),
    markFailed: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "failed" }),
  };
  return new PlanGenerationService(
    generator as never,
    specRepo as never,
    planRepo as never,
    undefined,
    undefined,
    undefined,
    undefined,
    userProfileSource as never,
    weightEntrySource as never,
  );
}

describe("PlanGenerationService — attachBodyProfile (17c-profile-body-metrics, PR 3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a no-op — generate() receives no bodyProfile key — when neither source is injected", async () => {
    const generator = { generate: vi.fn().mockResolvedValue(workoutProgram()) };
    const service = buildService(generator);

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    const spec = generator.generate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spec).not.toHaveProperty("bodyProfile");
  });

  it("attaches selfDescribedSex, heightCm, and the most recent bodyweight reading", async () => {
    const generator = { generate: vi.fn().mockResolvedValue(workoutProgram()) };
    const userProfileSource = {
      findByUserId: vi.fn().mockResolvedValue({ selfDescribedSex: "female", heightCm: 172 }),
    };
    const weightEntrySource = {
      // Newest-first, matching UserWeightEntryRepository.list()'s contract.
      list: vi.fn().mockResolvedValue([{ weightKg: 68 }, { weightKg: 70 }]),
    };
    const service = buildService(generator, userProfileSource, weightEntrySource);

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    const spec = generator.generate.mock.calls[0]?.[0] as { bodyProfile?: Record<string, unknown> };
    expect(spec.bodyProfile).toEqual({
      selfDescribedSex: "female",
      heightCm: 172,
      bodyweightKg: 68,
    });
  });

  it("drops prefer_not_to_say — it never reaches the generator, only the four representable values do", async () => {
    const generator = { generate: vi.fn().mockResolvedValue(workoutProgram()) };
    const userProfileSource = {
      findByUserId: vi.fn().mockResolvedValue({ selfDescribedSex: "prefer_not_to_say", heightCm: null }),
    };
    const weightEntrySource = { list: vi.fn().mockResolvedValue([]) };
    const service = buildService(generator, userProfileSource, weightEntrySource);

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    const spec = generator.generate.mock.calls[0]?.[0] as Record<string, unknown>;
    // No populated member at all (sex declined, no height, no weight) ⇒ no
    // bodyProfile key — the byte-identical-degradation contract.
    expect(spec).not.toHaveProperty("bodyProfile");
  });

  it("attaches only the populated fields when the profile row and weight series are partial", async () => {
    const generator = { generate: vi.fn().mockResolvedValue(workoutProgram()) };
    const userProfileSource = {
      findByUserId: vi.fn().mockResolvedValue({ selfDescribedSex: null, heightCm: null }),
    };
    const weightEntrySource = { list: vi.fn().mockResolvedValue([{ weightKg: 82 }]) };
    const service = buildService(generator, userProfileSource, weightEntrySource);

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    const spec = generator.generate.mock.calls[0]?.[0] as { bodyProfile?: Record<string, unknown> };
    expect(spec.bodyProfile).toEqual({ bodyweightKg: 82 });
  });

  it("degrades to no bodyProfile when the profile row does not exist and there are no weight entries", async () => {
    const generator = { generate: vi.fn().mockResolvedValue(workoutProgram()) };
    const userProfileSource = { findByUserId: vi.fn().mockResolvedValue(null) };
    const weightEntrySource = { list: vi.fn().mockResolvedValue([]) };
    const service = buildService(generator, userProfileSource, weightEntrySource);

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    const spec = generator.generate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spec).not.toHaveProperty("bodyProfile");
  });
});
