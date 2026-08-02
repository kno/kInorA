import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanGenerationService } from "../generation-service.js";
import { MockPlanGenerator } from "../mock-generator.js";
import type { ObservabilityLogger } from "../../observability/event-logger.js";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const USER = "aaaaaaaa-0000-0000-0000-000000000002";
const SPEC_ID = "spec-uuid-1";
const PLAN_ID = "plan-uuid-1";

const confirmedSpec = {
  goal: "strength",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: { strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
  confirmed: true,
};

function buildSpecRepo(row: unknown) {
  return { findConfirmedById: vi.fn().mockResolvedValue(row), create: vi.fn() };
}
function buildPlanRepo(overrides: Record<string, unknown> = {}) {
  return {
    createGenerating: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "generating" as const }),
    markReady: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "ready" }),
    markFailed: vi.fn().mockResolvedValue({ id: PLAN_ID, status: "failed" }),
    findById: vi.fn(),
    findLatestByPlanSpec: vi.fn(),
    ...overrides,
  };
}
function buildLogger(): ObservabilityLogger & { recordEvent: ReturnType<typeof vi.fn> } {
  return { recordEvent: vi.fn() };
}

describe("PlanGenerationService observability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records generation.started with planId + planSpecId (ids only) on start", async () => {
    const logger = buildLogger();
    const service = new PlanGenerationService(
      new MockPlanGenerator(),
      buildSpecRepo({ specJson: confirmedSpec }) as never,
      buildPlanRepo() as never,
      undefined,
      undefined,
      undefined,
      logger,
    );

    await service.startGeneration(TENANT, USER, SPEC_ID);

    expect(logger.recordEvent).toHaveBeenCalledWith({
      tenantId: TENANT,
      level: "info",
      event: "generation.started",
      metadata: { planId: PLAN_ID, planSpecId: SPEC_ID },
    });
  });

  it("records generation.ready after the background task succeeds", async () => {
    const logger = buildLogger();
    const service = new PlanGenerationService(
      new MockPlanGenerator(),
      buildSpecRepo({ specJson: confirmedSpec }) as never,
      buildPlanRepo() as never,
      undefined,
      undefined,
      undefined,
      logger,
    );

    await service.startGeneration(TENANT, USER, SPEC_ID);

    await vi.waitFor(() => {
      expect(logger.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          level: "info",
          event: "generation.ready",
          metadata: expect.objectContaining({ planId: PLAN_ID, planSpecId: SPEC_ID }),
        }),
      );
    });
  });

  it("records generation.failed with an errorName (no message content) when generation throws", async () => {
    const logger = buildLogger();
    const throwingGenerator = {
      generate: vi.fn().mockRejectedValue(new TypeError("boom internal detail")),
    };
    const service = new PlanGenerationService(
      throwingGenerator as never,
      buildSpecRepo({ specJson: confirmedSpec }) as never,
      buildPlanRepo() as never,
      undefined,
      undefined,
      undefined,
      logger,
    );

    await service.startGeneration(TENANT, USER, SPEC_ID);

    await vi.waitFor(() => {
      expect(logger.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          level: "error",
          event: "generation.failed",
          metadata: expect.objectContaining({
            planId: PLAN_ID,
            planSpecId: SPEC_ID,
            errorName: "TypeError",
          }),
        }),
      );
    });
    // PII invariant: the error MESSAGE must never be recorded — only the name.
    const failedCall = logger.recordEvent.mock.calls.find(
      ([arg]) => (arg as { event: string }).event === "generation.failed",
    );
    expect(JSON.stringify(failedCall)).not.toContain("boom internal detail");
  });

  it("records a warn event when markReady affects 0 rows (stale/race, no rows updated)", async () => {
    const logger = buildLogger();
    const service = new PlanGenerationService(
      new MockPlanGenerator(),
      buildSpecRepo({ specJson: confirmedSpec }) as never,
      buildPlanRepo({ markReady: vi.fn().mockResolvedValue(undefined) }) as never,
      undefined,
      undefined,
      undefined,
      logger,
    );

    await service.startGeneration(TENANT, USER, SPEC_ID);

    await vi.waitFor(() => {
      expect(logger.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          level: "warn",
          event: "generation.ready",
          outcome: "stale_no_rows",
          metadata: expect.objectContaining({ planId: PLAN_ID, planSpecId: SPEC_ID }),
        }),
      );
    });
    // PII invariant: only ids in metadata — no spec/program content.
    const staleCall = logger.recordEvent.mock.calls.find(
      ([arg]) => (arg as { outcome?: string }).outcome === "stale_no_rows",
    );
    expect(JSON.stringify(staleCall)).not.toContain("barbell");
  });

  it("works without a logger (optional dependency)", async () => {
    const service = new PlanGenerationService(
      new MockPlanGenerator(),
      buildSpecRepo({ specJson: confirmedSpec }) as never,
      buildPlanRepo() as never,
    );
    const result = await service.startGeneration(TENANT, USER, SPEC_ID);
    expect(result).toEqual({ planId: PLAN_ID, status: "generating" });
  });
});
