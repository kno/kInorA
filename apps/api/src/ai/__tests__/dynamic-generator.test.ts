import { describe, it, expect, vi, beforeEach } from "vitest";
import { DynamicPlanGenerator } from "../dynamic-generator.js";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";

// --- Fixtures ---

const baseSpec: PlanSpec = {
  goal: "strength",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: { strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
  confirmed: true,
};

const mockProgram: WorkoutProgram = {
  weeklySessions: [{ day: 1, title: "Day 1", exercises: [] }],
  limitationWarnings: [],
};

function buildConfigRepo(row: { provider: string; model: string } | null) {
  return { getActive: vi.fn().mockResolvedValue(row) };
}

function buildAdapterFactory(program: WorkoutProgram = mockProgram) {
  return vi.fn().mockResolvedValue(program);
}

// --- Tests ---

describe("DynamicPlanGenerator", () => {
  it("uses openrouter adapter when DB config says openrouter", async () => {
    const configRepo = buildConfigRepo({ provider: "openrouter", model: "openai/gpt-4o-mini" });
    const openrouterGenerate = buildAdapterFactory();
    const adapters = { openrouter: vi.fn().mockReturnValue({ generate: openrouterGenerate }) };

    const gen = new DynamicPlanGenerator(configRepo as never, adapters as never);
    const result = await gen.generate(baseSpec);

    expect(adapters.openrouter).toHaveBeenCalledWith("openai/gpt-4o-mini");
    expect(openrouterGenerate).toHaveBeenCalledWith(baseSpec);
    expect(result).toEqual(mockProgram);
  });

  it("uses openai adapter when DB config says openai", async () => {
    const configRepo = buildConfigRepo({ provider: "openai", model: "gpt-4o" });
    const openaiGenerate = buildAdapterFactory();
    const adapters = { openai: vi.fn().mockReturnValue({ generate: openaiGenerate }) };

    const gen = new DynamicPlanGenerator(configRepo as never, adapters as never);
    await gen.generate(baseSpec);

    expect(adapters.openai).toHaveBeenCalledWith("gpt-4o");
  });

  it("falls back to openrouter when DB config is null", async () => {
    const configRepo = buildConfigRepo(null);
    const openrouterGenerate = buildAdapterFactory();
    const adapters = { openrouter: vi.fn().mockReturnValue({ generate: openrouterGenerate }) };

    const gen = new DynamicPlanGenerator(configRepo as never, adapters as never);
    await gen.generate(baseSpec);

    expect(adapters.openrouter).toHaveBeenCalled();
  });

  it("falls back to openrouter (no crash) when the DB provider has no registered adapter", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // DB row references a provider that is NOT in the adapter map (e.g. stale/hand-edited row).
    const configRepo = buildConfigRepo({ provider: "nonexistent", model: "some-model" });
    const openrouterGenerate = buildAdapterFactory();
    const adapters = { openrouter: vi.fn().mockReturnValue({ generate: openrouterGenerate }) };

    const gen = new DynamicPlanGenerator(configRepo as never, adapters as never);
    const result = await gen.generate(baseSpec);

    // Generation must NOT crash; it degrades to openrouter with the openrouter default model.
    expect(adapters.openrouter).toHaveBeenCalledWith("openai/gpt-4o-mini");
    expect(openrouterGenerate).toHaveBeenCalledWith(baseSpec);
    expect(result).toEqual(mockProgram);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reads config from DB on every call (not cached)", async () => {
    const configRepo = buildConfigRepo({ provider: "openai", model: "gpt-4o-mini" });
    const openaiGenerate = buildAdapterFactory();
    const adapters = { openai: vi.fn().mockReturnValue({ generate: openaiGenerate }) };

    const gen = new DynamicPlanGenerator(configRepo as never, adapters as never);
    await gen.generate(baseSpec);
    await gen.generate(baseSpec);

    expect(configRepo.getActive).toHaveBeenCalledTimes(2);
  });
});
