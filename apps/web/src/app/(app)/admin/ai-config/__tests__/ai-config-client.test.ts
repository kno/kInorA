import { describe, it, expect, vi } from "vitest";
import {
  fetchAiConfig,
  updateAiConfig,
  MODEL_DEFAULTS,
  VALID_PROVIDERS,
} from "../ai-config-client.js";

// --- Fixtures ---

const CONFIG: { provider: "openai"; model: string; updatedAt: string } = {
  provider: "openai",
  model: "gpt-4o-mini",
  updatedAt: "2026-06-30T00:00:00.000Z",
};

function buildFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

// --- MODEL_DEFAULTS ---

describe("MODEL_DEFAULTS", () => {
  it("has a default model for every valid provider", () => {
    for (const provider of VALID_PROVIDERS) {
      expect(MODEL_DEFAULTS[provider]).toBeTruthy();
      expect(typeof MODEL_DEFAULTS[provider]).toBe("string");
    }
  });

  it("returns the design-specified default for openrouter", () => {
    expect(MODEL_DEFAULTS.openrouter).toBe("openai/gpt-4o-mini");
  });

  it("returns the design-specified default for anthropic", () => {
    expect(MODEL_DEFAULTS.anthropic).toBe("claude-3-5-haiku-20241022");
  });
});

// --- fetchAiConfig ---

describe("fetchAiConfig", () => {
  it("returns ok with config when the API responds 200", async () => {
    const fetchMock = buildFetch(200, CONFIG);

    const result = await fetchAiConfig("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.config?.provider).toBe("openai");
      expect(result.config?.model).toBe("gpt-4o-mini");
    }
  });

  it("returns ok with null config when the API body is null (SC-12 fallback)", async () => {
    const fetchMock = buildFetch(200, null);

    const result = await fetchAiConfig("tok-1", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.config).toBeNull();
    }
  });

  it("returns forbidden when the API responds 403 (SC-13)", async () => {
    const fetchMock = buildFetch(403, { error: "forbidden" });

    const result = await fetchAiConfig("tok-bad", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("forbidden");
  });

  it("sends the Bearer token in the Authorization header", async () => {
    const fetchMock = buildFetch(200, CONFIG);

    await fetchAiConfig("my-token", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");
  });
});

// --- updateAiConfig ---

describe("updateAiConfig", () => {
  it("returns ok with updated config when the API responds 200 (SC-15)", async () => {
    const fetchMock = buildFetch(200, { ...CONFIG, provider: "openai", model: "gpt-4o" });

    const result = await updateAiConfig("tok-1", "openai", "gpt-4o", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.config.provider).toBe("openai");
      expect(result.config.model).toBe("gpt-4o");
    }
  });

  it("returns forbidden when the API responds 403", async () => {
    const fetchMock = buildFetch(403, { error: "forbidden" });

    const result = await updateAiConfig("tok-bad", "openai", "gpt-4o", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("forbidden");
  });

  it("returns invalid when the API responds 422", async () => {
    const fetchMock = buildFetch(422, { error: "Validation Error" });

    const result = await updateAiConfig("tok-1", "openai", "", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    expect(result.kind).toBe("invalid");
  });

  it("sends PUT with provider and model in the JSON body", async () => {
    const fetchMock = buildFetch(200, CONFIG);

    await updateAiConfig("tok-1", "anthropic", "claude-3-5-haiku-20241022", {
      apiBaseUrl: "http://api",
      fetchImpl: fetchMock as never,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { provider: string; model: string };
    expect(body.provider).toBe("anthropic");
    expect(body.model).toBe("claude-3-5-haiku-20241022");
  });
});
