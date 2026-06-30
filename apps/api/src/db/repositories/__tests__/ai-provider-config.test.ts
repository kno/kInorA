import { describe, it, expect, vi } from "vitest";
import { AiProviderConfigRepository } from "../ai-provider-config.js";

// --- Fixtures ---

const CONFIG_ROW = {
  id: "cfg-uuid-1",
  provider: "openrouter" as const,
  model: "openai/gpt-4o-mini",
  updatedAt: new Date("2026-06-30T10:00:00Z"),
};

// --- Mock DB helpers ---

function selectChain(rows: unknown[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function upsertChain() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([CONFIG_ROW]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    }),
  };
}

// --- Tests ---

describe("AiProviderConfigRepository", () => {
  describe("getActive", () => {
    it("returns the active config row when one exists", async () => {
      const db = selectChain([CONFIG_ROW]);
      const repo = new AiProviderConfigRepository(db as never);

      const result = await repo.getActive();

      expect(result).not.toBeNull();
      expect(result?.provider).toBe("openrouter");
      expect(result?.model).toBe("openai/gpt-4o-mini");
    });

    it("returns null when no config row exists", async () => {
      const db = selectChain([]);
      const repo = new AiProviderConfigRepository(db as never);

      const result = await repo.getActive();

      expect(result).toBeNull();
    });
  });

  describe("upsert", () => {
    it("returns the upserted config with the given provider and model", async () => {
      const db = {
        ...selectChain([]),
        ...upsertChain(),
        delete: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { ...CONFIG_ROW, provider: "openai", model: "gpt-4o" },
            ]),
          }),
        }),
      };
      const repo = new AiProviderConfigRepository(db as never);

      const result = await repo.upsert("openai", "gpt-4o");

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
    });
  });
});
