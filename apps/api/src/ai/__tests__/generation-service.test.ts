import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanGenerationService } from "../generation-service.js";
import { MockPlanGenerator } from "../mock-generator.js";
import type { WorkoutProgram } from "@kinora/contracts";

// --- Fixtures ---

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const SPEC_ID = "spec-uuid-1";
const PLAN_ID = "plan-uuid-1";

const confirmedSpec = {
  goal: "strength",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: {
    strength: 0.9,
    hypertrophy: 0.6,
    endurance: 0.2,
    mobility: 0.3,
  },
  confirmed: true,
};

const mockProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Upper Body",
      exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }],
    },
  ],
  limitationWarnings: [],
};

// --- Mock factories ---

/**
 * Build a mock PlanSpecRepository.
 * findConfirmedById returns the provided row (or undefined to simulate missing/unconfirmed).
 */
function buildMockSpecRepo(row: unknown | undefined) {
  return {
    findConfirmedById: vi.fn().mockResolvedValue(row),
    create: vi.fn(),
  };
}

/**
 * Build a mock WorkoutPlanRepository.
 * createGenerating returns { id, status: "generating" }.
 * markReady and markFailed resolve with the updated row.
 */
function buildMockPlanRepo(planId = PLAN_ID) {
  return {
    createGenerating: vi.fn().mockResolvedValue({ id: planId, status: "generating" as const }),
    markReady: vi.fn().mockResolvedValue({ id: planId, status: "ready" }),
    markFailed: vi.fn().mockResolvedValue({ id: planId, status: "failed" }),
    findById: vi.fn(),
    findLatestByPlanSpec: vi.fn(),
  };
}

// --- Tests ---

describe("PlanGenerationService", () => {
  let generator: MockPlanGenerator;

  beforeEach(() => {
    generator = new MockPlanGenerator();
    vi.clearAllMocks();
  });

  describe("startGeneration — spec validation (422 class)", () => {
    it("throws when findConfirmedById returns undefined (spec missing or unconfirmed)", async () => {
      const specRepo = buildMockSpecRepo(undefined);
      const planRepo = buildMockPlanRepo();
      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);

      await expect(
        service.startGeneration(TENANT_A, USER_A, SPEC_ID)
      ).rejects.toThrow(/not found|unconfirmed/i);

      // Generator must NOT be called before validation
      expect(planRepo.createGenerating).not.toHaveBeenCalled();
    });

    it("does NOT call the generator on missing spec", async () => {
      const specRepo = buildMockSpecRepo(undefined);
      const planRepo = buildMockPlanRepo();
      // Spy directly on the generator.generate method
      const generateSpy = vi.spyOn(generator, "generate");
      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);

      await expect(service.startGeneration(TENANT_A, USER_A, SPEC_ID)).rejects.toThrow();
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it("throws when the spec fails assertPlanSpecShape (invalid spec shape)", async () => {
      // A spec without preferenceScores or confirmed will fail assertPlanSpecShape
      const invalidSpec = { specJson: { goal: "strength" } };
      const specRepo = buildMockSpecRepo(invalidSpec);
      const planRepo = buildMockPlanRepo();
      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);

      await expect(service.startGeneration(TENANT_A, USER_A, SPEC_ID)).rejects.toThrow();
      expect(planRepo.createGenerating).not.toHaveBeenCalled();
    });
  });

  describe("startGeneration — happy path", () => {
    it("returns { planId, status: 'generating' } immediately without awaiting LLM", async () => {
      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      // Make the generator slow — the route must not await it
      let resolveGenerate!: () => void;
      const slowGenerate = vi.fn().mockImplementation(
        () =>
          new Promise<WorkoutProgram>((resolve) => {
            resolveGenerate = () => resolve(mockProgram);
          })
      );
      const slowGenerator = { generate: slowGenerate };

      const service = new PlanGenerationService(
        slowGenerator as never,
        specRepo as never,
        planRepo as never
      );

      // startGeneration resolves immediately (does NOT wait for generate)
      const result = await service.startGeneration(TENANT_A, USER_A, SPEC_ID);

      expect(result).toEqual({ planId: PLAN_ID, status: "generating" });
      // At this point, the background task has NOT completed
      expect(planRepo.markReady).not.toHaveBeenCalled();

      // Let the background task complete now
      resolveGenerate();
      // Flush the microtask queue
      await new Promise((r) => setTimeout(r, 0));
    });

    it("calls createGenerating with tenantId, userId, planSpecId", async () => {
      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);

      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);

      expect(planRepo.createGenerating).toHaveBeenCalledWith(TENANT_A, USER_A, SPEC_ID);
    });
  });

  describe("background task — success path", () => {
    it("calls markReady with tenantId + planId + WorkoutProgram on successful generation", async () => {
      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      // Override generator.generate to return a known program
      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);

      // Wait for background task to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(planRepo.markReady).toHaveBeenCalledTimes(1);
      const [calledTenantId, calledPlanId, calledProgram] =
        planRepo.markReady.mock.calls[0] as [string, string, WorkoutProgram];
      expect(calledTenantId).toBe(TENANT_A);
      expect(calledPlanId).toBe(PLAN_ID);
      // The program passed to markReady must have the same weeklySessions count as mock
      expect(calledProgram.weeklySessions).toHaveLength(mockProgram.weeklySessions.length);
    });
  });

  describe("background task — failure path", () => {
    it("calls markFailed with tenantId + planId + error message when generator throws", async () => {
      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      const generationError = new Error("LLM timeout");
      vi.spyOn(generator, "generate").mockRejectedValue(generationError);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);

      // Wait for background task to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(planRepo.markFailed).toHaveBeenCalledTimes(1);
      const [calledTenantId, calledPlanId, calledMessage] =
        planRepo.markFailed.mock.calls[0] as [string, string, string];
      expect(calledTenantId).toBe(TENANT_A);
      expect(calledPlanId).toBe(PLAN_ID);
      expect(calledMessage).toContain("LLM timeout");
    });

    it("calls markFailed (not markReady) when assertNoDiagnosticLanguage rejects the program", async () => {
      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      // Return a program with diagnostic language that the guard will reject
      const diagnosticProgram: WorkoutProgram = {
        weeklySessions: [
          {
            day: 1,
            title: "Day 1",
            exercises: [
              {
                name: "Squat",
                sets: 3,
                reps: "10",
                restSeconds: 60,
                notes: "You have a herniated disc",
              },
            ],
          },
        ],
        limitationWarnings: [],
      };
      vi.spyOn(generator, "generate").mockResolvedValue(diagnosticProgram);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);

      await new Promise((r) => setTimeout(r, 10));

      expect(planRepo.markFailed).toHaveBeenCalledTimes(1);
      expect(planRepo.markReady).not.toHaveBeenCalled();
    });

    it("does NOT propagate promise rejection (no unhandledRejection)", async () => {
      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      // markFailed itself throws — must not cause unhandledRejection
      planRepo.markFailed.mockRejectedValue(new Error("DB error in markFailed"));
      vi.spyOn(generator, "generate").mockRejectedValue(new Error("LLM error"));

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);

      // startGeneration must resolve without throwing
      await expect(service.startGeneration(TENANT_A, USER_A, SPEC_ID)).resolves.toBeDefined();

      // Allow background task to run
      await new Promise((r) => setTimeout(r, 10));
    });
  });
});
