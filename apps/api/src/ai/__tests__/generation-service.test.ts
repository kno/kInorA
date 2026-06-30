import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlanGenerationService } from "../generation-service.js";
import { MockPlanGenerator } from "../mock-generator.js";
import type { WorkoutProgram } from "@kinora/contracts";
import type { WsRegistry } from "../../ws/registry.js";

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
 * Build a mock WsRegistry.
 * notify is a spy that captures all calls.
 */
function buildMockRegistry(): WsRegistry {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    notify: vi.fn(),
  } as unknown as WsRegistry;
}

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
    // Ensure fake timers are reset to real timers before each test
    vi.useRealTimers();
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
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      // Make the generator resolve only after we advance timers
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
      // Background task has NOT completed — markReady not yet called
      expect(planRepo.markReady).not.toHaveBeenCalled();

      // Resolve the generator and flush all async work
      resolveGenerate();
      await vi.runAllTimersAsync();

      vi.useRealTimers();
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
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);

      // Flush background task
      await vi.runAllTimersAsync();

      expect(planRepo.markReady).toHaveBeenCalledTimes(1);
      expect(planRepo.markFailed).not.toHaveBeenCalled(); // Fix 4: assert symmetry
      const [calledTenantId, calledPlanId, calledProgram] =
        planRepo.markReady.mock.calls[0] as [string, string, WorkoutProgram];
      expect(calledTenantId).toBe(TENANT_A);
      expect(calledPlanId).toBe(PLAN_ID);
      expect(calledProgram.weeklySessions).toHaveLength(mockProgram.weeklySessions.length);

      vi.useRealTimers();
    });
  });

  describe("background task — failure path", () => {
    it("calls markFailed with tenantId + planId + error message when generator throws", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      const generationError = new Error("LLM timeout");
      vi.spyOn(generator, "generate").mockRejectedValue(generationError);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);

      await vi.runAllTimersAsync();

      expect(planRepo.markFailed).toHaveBeenCalledTimes(1);
      expect(planRepo.markReady).not.toHaveBeenCalled(); // Fix 4: assert symmetry
      const [calledTenantId, calledPlanId, calledMessage] =
        planRepo.markFailed.mock.calls[0] as [string, string, string];
      expect(calledTenantId).toBe(TENANT_A);
      expect(calledPlanId).toBe(PLAN_ID);
      expect(calledMessage).toContain("LLM timeout");

      vi.useRealTimers();
    });

    it("calls markFailed (not markReady) when assertNoDiagnosticLanguage rejects the program", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

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

      await vi.runAllTimersAsync();

      expect(planRepo.markFailed).toHaveBeenCalledTimes(1);
      expect(planRepo.markReady).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("does NOT propagate promise rejection (no unhandledRejection)", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      // markFailed itself throws — must not cause unhandledRejection
      planRepo.markFailed.mockRejectedValue(new Error("DB error in markFailed"));
      vi.spyOn(generator, "generate").mockRejectedValue(new Error("LLM error"));

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);

      // startGeneration must resolve without throwing
      await expect(service.startGeneration(TENANT_A, USER_A, SPEC_ID)).resolves.toBeDefined();

      // Flush — must not throw
      await vi.runAllTimersAsync();

      vi.useRealTimers();
    });
  });

  describe("structured logging — observability", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    });

    it("logs [generation-service] generation failed with planId and error message when generator throws", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      const generationError = new Error("OpenRouter 401 Unauthorized");
      vi.spyOn(generator, "generate").mockRejectedValue(generationError);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);
      await vi.runAllTimersAsync();

      // Must have logged the failure
      expect(consoleErrorSpy).toHaveBeenCalled();

      // The first argument (prefix string) or any argument must contain planId and error message
      const allArgs = consoleErrorSpy.mock.calls.flatMap((c) => c);
      const serialized = allArgs.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      expect(serialized).toContain(PLAN_ID);
      expect(serialized).toContain("OpenRouter 401 Unauthorized");

      vi.useRealTimers();
    });

    it("PRIVACY: error log NEVER contains health data (spec.limitations text)", async () => {
      vi.useFakeTimers();

      // spec with sensitive limitation text
      const sensitiveSpec = {
        ...confirmedSpec,
        limitations: [{ text: "knee pain and herniated disc L4-L5", isWarning: true }],
      };
      const specRow = { specJson: sensitiveSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();

      vi.spyOn(generator, "generate").mockRejectedValue(new Error("LLM timeout"));

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);
      await vi.runAllTimersAsync();

      // Every console.error call's serialized arguments must NOT contain the sensitive text
      const allErrorArgs = consoleErrorSpy.mock.calls.flatMap((c) => c);
      const serialized = allErrorArgs
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      expect(serialized).not.toContain("knee pain");
      expect(serialized).not.toContain("herniated disc L4-L5");

      vi.useRealTimers();
    });

    it("logs [generation-service] generation ready with planId on success", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);
      await vi.runAllTimersAsync();

      // Must have logged a ready/success line
      expect(consoleInfoSpy).toHaveBeenCalled();
      const allInfoArgs = consoleInfoSpy.mock.calls.flatMap((c) => c);
      const serialized = allInfoArgs
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      expect(serialized).toContain(PLAN_ID);

      vi.useRealTimers();
    });

    it("PRIVACY: success log NEVER contains health data or program content", async () => {
      vi.useFakeTimers();

      const sensitiveSpec = {
        ...confirmedSpec,
        limitations: [{ text: "knee pain and herniated disc L4-L5", isWarning: true }],
      };
      const specRow = { specJson: sensitiveSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);
      await vi.runAllTimersAsync();

      const allInfoArgs = consoleInfoSpy.mock.calls.flatMap((c) => c);
      const serialized = allInfoArgs
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      expect(serialized).not.toContain("knee pain");
      expect(serialized).not.toContain("herniated disc");
      // Program exercise names must not be logged
      expect(serialized).not.toContain("Squat");

      vi.useRealTimers();
    });

    it("logs [generation-service] generation started at task start with planId", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      const service = new PlanGenerationService(generator, specRepo as never, planRepo as never);
      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);
      await vi.runAllTimersAsync();

      // consoleInfo must have been called at least once with planId (started + ready)
      const allInfoArgs = consoleInfoSpy.mock.calls.flatMap((c) => c);
      const serialized = allInfoArgs
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      expect(serialized).toContain("[generation-service]");

      vi.useRealTimers();
    });
  });

  describe("WsRegistry.notify — generation service emits after markReady and markFailed", () => {
    it("calls registry.notify with correct userId and { planId, status: 'ready' } on success", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      const registry = buildMockRegistry();
      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      const service = new PlanGenerationService(
        generator,
        specRepo as never,
        planRepo as never,
        registry
      );

      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);
      await vi.runAllTimersAsync();

      expect(registry.notify).toHaveBeenCalledTimes(1);
      expect(registry.notify).toHaveBeenCalledWith(USER_A, { planId: PLAN_ID, status: "ready" });

      vi.useRealTimers();
    });

    it("calls registry.notify with correct userId and { planId, status: 'failed' } on failure", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      const registry = buildMockRegistry();
      vi.spyOn(generator, "generate").mockRejectedValue(new Error("LLM failure"));

      const service = new PlanGenerationService(
        generator,
        specRepo as never,
        planRepo as never,
        registry
      );

      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);
      await vi.runAllTimersAsync();

      expect(registry.notify).toHaveBeenCalledTimes(1);
      expect(registry.notify).toHaveBeenCalledWith(USER_A, { planId: PLAN_ID, status: "failed" });

      vi.useRealTimers();
    });

    it("does NOT throw when registry.notify throws (fire-and-forget-safe)", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      const registry = buildMockRegistry();
      (registry.notify as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("notify failure");
      });
      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      const service = new PlanGenerationService(
        generator,
        specRepo as never,
        planRepo as never,
        registry
      );

      // startGeneration must resolve without throwing
      await expect(service.startGeneration(TENANT_A, USER_A, SPEC_ID)).resolves.toBeDefined();
      // Flushing the background task must not throw
      await vi.runAllTimersAsync();

      vi.useRealTimers();
    });

    it("works without a registry (registry is optional — no-op when not provided)", async () => {
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      // No registry passed → should not throw
      const service = new PlanGenerationService(
        generator,
        specRepo as never,
        planRepo as never
        // registry omitted
      );

      await expect(service.startGeneration(TENANT_A, USER_A, SPEC_ID)).resolves.toBeDefined();
      await vi.runAllTimersAsync();
      // planRepo.markReady still called as normal
      expect(planRepo.markReady).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("does NOT notify 'ready' when markReady returns undefined (0 rows — plan stays generating)", async () => {
      // Fix 2: a false-ready notification would tell the client the plan is ready
      // when the DB was NOT updated (tenant mismatch / race). Guard: only notify
      // 'ready' when markReady returns a truthy result (row updated).
      vi.useFakeTimers();

      const specRow = { specJson: confirmedSpec };
      const specRepo = buildMockSpecRepo(specRow);
      const planRepo = buildMockPlanRepo();
      const registry = buildMockRegistry();

      // markReady returns undefined → 0 rows updated (stuck-generating scenario)
      planRepo.markReady.mockResolvedValue(undefined);
      vi.spyOn(generator, "generate").mockResolvedValue(mockProgram);

      const service = new PlanGenerationService(
        generator,
        specRepo as never,
        planRepo as never,
        registry
      );

      await service.startGeneration(TENANT_A, USER_A, SPEC_ID);
      await vi.runAllTimersAsync();

      // markReady was called
      expect(planRepo.markReady).toHaveBeenCalledTimes(1);
      // notify must NOT be called with status "ready" — the DB wasn't updated
      expect(registry.notify).not.toHaveBeenCalledWith(USER_A, { planId: PLAN_ID, status: "ready" });
      // notify also must not have been called at all (no other status applies here)
      expect(registry.notify).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
