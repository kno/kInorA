import { describe, it, expect, vi } from "vitest";
import { ResolvePrompt, resolvePromptCacheTtlMs } from "../prompt-provider.js";
import { PromptNotFoundError, type LangfusePromptGateway } from "../prompt-source-port.js";
import { renderTemplate, type PromptDefinition } from "../prompt-template.js";

// Mirrors ResolveBillingPricing's test style (billing-pricing.test.ts) — a
// fake gateway + an injected clock, no network, no credentials.

const DEF: PromptDefinition = {
  name: "kinora-test-prompt",
  localTemplate: "LOCAL {{x}} value",
  variables: ["x"],
  requiredMarkers: ["{{x}}"],
  orderedMarkers: ["{{x}}"],
  maxTemplateChars: 1000,
};

const VARS = { x: "42" };

function buildGateway(
  impl: (name: string, label: string) => Promise<{ template: unknown; version: number }>
) {
  const fetchPrompt = vi.fn(impl);
  const gateway: LangfusePromptGateway = { fetchPrompt };
  return { gateway, fetchPrompt };
}

describe("ResolvePrompt", () => {
  it("serves the successfully fetched remote template rendered, with source langfuse", async () => {
    const { gateway } = buildGateway(async () => ({ template: "REMOTE {{x}}", version: 3 }));
    const useCase = new ResolvePrompt(gateway);

    const resolution = await useCase.execute(DEF, VARS);

    expect(resolution).toEqual({
      text: "REMOTE 42",
      source: "langfuse",
      name: DEF.name,
      version: 3,
    });
  });

  it("caches a resolved prompt so a warm cache makes zero further gateway calls", async () => {
    const { gateway, fetchPrompt } = buildGateway(async () => ({
      template: DEF.localTemplate,
      version: 1,
    }));
    const useCase = new ResolvePrompt(gateway, { cacheTtlMs: 60_000, now: () => 0 });

    await useCase.execute(DEF, VARS);
    await useCase.execute(DEF, VARS);
    await useCase.execute(DEF, VARS);

    expect(fetchPrompt).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cache TTL has elapsed", async () => {
    const { gateway, fetchPrompt } = buildGateway(async () => ({
      template: DEF.localTemplate,
      version: 1,
    }));
    let clock = 0;
    const useCase = new ResolvePrompt(gateway, { cacheTtlMs: 60_000, now: () => clock });

    await useCase.execute(DEF, VARS);
    clock = 60_001;
    await useCase.execute(DEF, VARS);

    expect(fetchPrompt).toHaveBeenCalledTimes(2);
  });

  it("coalesces a cold-cache burst of concurrent callers into a SINGLE upstream fetch", async () => {
    const { gateway, fetchPrompt } = buildGateway(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ template: DEF.localTemplate, version: 1 }), 0)
        )
    );
    const useCase = new ResolvePrompt(gateway);

    const results = await Promise.all(Array.from({ length: 5 }, () => useCase.execute(DEF, VARS)));

    expect(fetchPrompt).toHaveBeenCalledTimes(1);
    for (const resolution of results) {
      expect(resolution.source).toBe("langfuse");
    }
  });

  it("gateway === null (no credentials) falls back with reason no_credentials and no gateway call", async () => {
    const warn = vi.fn();
    const useCase = new ResolvePrompt(null, { warn });

    const resolution = await useCase.execute(DEF, VARS);

    expect(resolution).toEqual({
      text: renderTemplate(DEF.localTemplate, VARS),
      source: "fallback",
    });
    expect(warn).toHaveBeenCalledWith("no_credentials", DEF.name, undefined);
  });

  it("falls back on a generic fetch failure (network/auth) with reason fetch_failed", async () => {
    const { gateway } = buildGateway(async () => {
      throw new Error("connection refused");
    });
    const warn = vi.fn();
    const useCase = new ResolvePrompt(gateway, { warn });

    const resolution = await useCase.execute(DEF, VARS);

    expect(resolution.source).toBe("fallback");
    expect(warn).toHaveBeenCalledWith("fetch_failed", DEF.name, "Error");
  });

  it("falls back on a missing-prompt failure with reason prompt_not_found", async () => {
    const { gateway } = buildGateway(async () => {
      throw new PromptNotFoundError(DEF.name);
    });
    const warn = vi.fn();
    const useCase = new ResolvePrompt(gateway, { warn });

    const resolution = await useCase.execute(DEF, VARS);

    expect(resolution.source).toBe("fallback");
    expect(warn).toHaveBeenCalledWith("prompt_not_found", DEF.name, "PromptNotFoundError");
  });

  it("falls back on a malformed remote template with the validator's reason code", async () => {
    const { gateway } = buildGateway(async () => ({ template: 42, version: 1 })); // not a string
    const warn = vi.fn();
    const useCase = new ResolvePrompt(gateway, { warn });

    const resolution = await useCase.execute(DEF, VARS);

    expect(resolution.source).toBe("fallback");
    expect(warn).toHaveBeenCalledWith("payload_not_string", DEF.name, undefined);
  });

  it("falls back when the rendered output still has an unresolved marker", async () => {
    // A malformed marker (stray whitespace) that `templateVariablesOf` cannot
    // detect as a variable reference — passes pre-render validation but
    // never resolves at render time.
    const { gateway } = buildGateway(async () => ({ template: "{{x}} {{ x }}", version: 1 }));
    const warn = vi.fn();
    const useCase = new ResolvePrompt(gateway, { warn });

    const resolution = await useCase.execute(DEF, VARS);

    expect(resolution.source).toBe("fallback");
    expect(warn).toHaveBeenCalledWith("unresolved_marker_after_render", DEF.name, undefined);
  });

  it("caches the fallback too — only the first request in a TTL window attempts the upstream call", async () => {
    const { gateway, fetchPrompt } = buildGateway(async () => {
      throw new Error("outage");
    });
    const useCase = new ResolvePrompt(gateway, { cacheTtlMs: 60_000, now: () => 0 });

    await useCase.execute(DEF, VARS);
    await useCase.execute(DEF, VARS);
    await useCase.execute(DEF, VARS);

    expect(fetchPrompt).toHaveBeenCalledTimes(1);
  });

  it("matches the local path byte-for-byte when the remote template equals the local one", async () => {
    const { gateway } = buildGateway(async () => ({ template: DEF.localTemplate, version: 9 }));
    const useCase = new ResolvePrompt(gateway);

    const resolution = await useCase.execute(DEF, VARS);

    expect(resolution.text).toBe(renderTemplate(DEF.localTemplate, VARS));
    expect(resolution.source).toBe("langfuse");
  });
});

describe("resolvePromptCacheTtlMs", () => {
  it("defaults to 60000 ms when unset", () => {
    expect(resolvePromptCacheTtlMs({})).toBe(60_000);
  });

  it("honors a valid positive integer", () => {
    expect(resolvePromptCacheTtlMs({ LANGFUSE_PROMPT_CACHE_TTL_MS: "15000" })).toBe(15_000);
  });

  it("falls back to the default for an unparseable value, without throwing", () => {
    expect(() => resolvePromptCacheTtlMs({ LANGFUSE_PROMPT_CACHE_TTL_MS: "abc" })).not.toThrow();
    expect(resolvePromptCacheTtlMs({ LANGFUSE_PROMPT_CACHE_TTL_MS: "abc" })).toBe(60_000);
  });

  it("falls back to the default for zero, without throwing", () => {
    expect(resolvePromptCacheTtlMs({ LANGFUSE_PROMPT_CACHE_TTL_MS: "0" })).toBe(60_000);
  });

  it("falls back to the default for a negative value, without throwing", () => {
    expect(resolvePromptCacheTtlMs({ LANGFUSE_PROMPT_CACHE_TTL_MS: "-5" })).toBe(60_000);
  });
});
