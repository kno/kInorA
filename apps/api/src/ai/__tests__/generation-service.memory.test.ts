import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";
import {
  createOptionalVectorMemoryServices,
  resolveEmbeddingRuntimeConfig,
} from "../../app.js";
import { PlanGenerationService } from "../generation-service.js";

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
  preferenceScores: {
    strength: 0.8,
    hypertrophy: 0.6,
    endurance: 0.2,
    mobility: 0.3,
  },
  confirmed: true,
};

const compatibleMemory = {
  id: "mem-1",
  tenantId: TENANT_ID,
  userId: USER_ID,
  summary: "Prefers morning workouts",
  source: "user_confirmation",
  status: "active" as const,
  eligibility: "eligible" as const,
  consentStatus: "granted" as const,
  consentedAt: new Date("2026-07-22T12:00:00.000Z"),
  revokedAt: null,
  idempotencyKey: "idem-1",
  fingerprint: "fingerprint-1",
  schemaVersion: "1",
  embeddingProvider: "openai",
  embeddingModel: "text-embedding-3-small",
  embeddingVersion: "text-embedding-3-small",
  embeddingDimension: 1536,
  embedding: new Array(1536).fill(0.1),
  disabledAt: null,
  deletedAt: null,
  createdAt: new Date("2026-07-22T12:00:00.000Z"),
  updatedAt: new Date("2026-07-22T12:00:00.000Z"),
};

function workoutProgram(title = "Generated plan"): WorkoutProgram {
  return {
    weeklySessions: [
      {
        day: 1,
        title,
        exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }],
      },
    ],
    limitationWarnings: [],
  };
}

describe("PlanGenerationService vector memory integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("injects compatible approved memory into the bounded generation input", async () => {
    const generator = {
      generate: vi.fn(async (spec: PlanSpec & { memoryContext?: string[] }) =>
        workoutProgram(spec.memoryContext?.[0] ?? "Generated plan"),
      ),
    };
    const specRepo = {
      findConfirmedById: vi.fn().mockResolvedValue({ specJson: confirmedSpec }),
    };
    const planRepo = {
      createGenerating: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "generating" }),
      markReady: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "ready" }),
      markFailed: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "failed" }),
    };
    const memoryRetriever = {
      retrieve: vi.fn().mockResolvedValue([compatibleMemory]),
    };
    const service = new PlanGenerationService(
      generator as never,
      specRepo as never,
      planRepo as never,
      undefined,
      memoryRetriever as never,
    );

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    expect(memoryRetriever.retrieve).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, userId: USER_ID },
      expect.objectContaining({ limit: 3 }),
    );
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({ memoryContext: ["Prefers morning workouts"] }),
    );
    expect(planRepo.markReady.mock.calls[0][2].weeklySessions[0].title).toBe(
      "Prefers morning workouts",
    );
  });

  it("fails open to the default generation path when no active memory exists", async () => {
    const generator = {
      generate: vi.fn(async (spec: PlanSpec & { memoryContext?: string[] }) =>
        workoutProgram(spec.memoryContext?.[0] ?? "Generated plan"),
      ),
    };
    const specRepo = {
      findConfirmedById: vi.fn().mockResolvedValue({ specJson: confirmedSpec }),
    };
    const planRepo = {
      createGenerating: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "generating" }),
      markReady: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "ready" }),
      markFailed: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "failed" }),
    };
    const memoryRetriever = {
      retrieve: vi.fn().mockResolvedValue([]),
    };
    const service = new PlanGenerationService(
      generator as never,
      specRepo as never,
      planRepo as never,
      undefined,
      memoryRetriever as never,
    );

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    expect(generator.generate).toHaveBeenCalledWith(
      expect.not.objectContaining({ memoryContext: expect.anything() }),
    );
    expect(planRepo.markReady.mock.calls[0][2].weeklySessions[0].title).toBe("Generated plan");
  });

  it("fails open and records non-sensitive telemetry when retrieval rejects", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const generator = {
      generate: vi.fn(async () => workoutProgram()),
    };
    const specRepo = {
      findConfirmedById: vi.fn().mockResolvedValue({ specJson: confirmedSpec }),
    };
    const planRepo = {
      createGenerating: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "generating" }),
      markReady: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "ready" }),
      markFailed: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "failed" }),
    };
    const memoryRetriever = {
      retrieve: vi.fn().mockRejectedValue(new Error("database contains raw user content")),
    };
    const service = new PlanGenerationService(
      generator as never,
      specRepo as never,
      planRepo as never,
      undefined,
      memoryRetriever as never,
    );

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    expect(planRepo.markReady).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[generation-service] vector memory retrieval failed",
      expect.objectContaining({ planId: PLAN_ID, tenantId: TENANT_ID }),
    );
    expect(JSON.stringify(consoleWarnSpy.mock.calls)).not.toContain("raw user content");
  });

  it("redacts limitation text before constructing the retrieval query", async () => {
    const sensitiveLimitation = "knee pain and herniated disc L4-L5";
    const generator = { generate: vi.fn(async () => workoutProgram()) };
    const specRepo = {
      findConfirmedById: vi.fn().mockResolvedValue({
        specJson: { ...confirmedSpec, limitations: [{ text: sensitiveLimitation, isWarning: true }] },
      }),
    };
    const planRepo = {
      createGenerating: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "generating" }),
      markReady: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "ready" }),
      markFailed: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "failed" }),
    };
    const memoryRetriever = { retrieve: vi.fn().mockResolvedValue([]) };
    const service = new PlanGenerationService(
      generator as never,
      specRepo as never,
      planRepo as never,
      undefined,
      memoryRetriever as never,
    );

    await service.startGeneration(TENANT_ID, USER_ID, SPEC_ID);
    await vi.runAllTimersAsync();

    const query = memoryRetriever.retrieve.mock.calls[0]?.[1].query as string;
    expect(query).not.toContain(sensitiveLimitation);
    expect(query).toContain("[REDACTED]");
  });

  it("does not enable retrieval or throw when optional embedding config is invalid", async () => {
    const config = resolveEmbeddingRuntimeConfig({
      VECTOR_MEMORY_EMBEDDING_PROVIDER: "unsupported-provider",
      VECTOR_MEMORY_EMBEDDING_DIMENSION: "3",
    });
    const services = createOptionalVectorMemoryServices({} as never, config);

    expect(services.retriever).toBeUndefined();
    await expect(
      services.writer.saveConfirmedMemory(
        { tenantId: "tenant", userId: "user" },
        {} as never,
      ),
    ).resolves.toEqual({ kind: "failed", reason: "misconfigured" });
  });
});
