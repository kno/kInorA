import { describe, it, expect, vi } from "vitest";
import {
  ResolvePrompt,
  resolvePromptCacheTtlMs,
  PROMPT_TEMPLATE_DRIFT_EVENT,
} from "../prompt-provider.js";
import { PromptNotFoundError, type LangfusePromptGateway } from "../prompt-source-port.js";
import {
  renderTemplate,
  templateVariablesOf,
  type PromptDefinition,
} from "../prompt-template.js";
import { PLAN_PROMPT_DEFINITION } from "../prompt.js";
import {
  REPLY_PROMPT_DEFINITION,
  EXTRACTION_PROMPT_DEFINITION,
} from "../extraction-prompt.js";
import type {
  ObservabilityEventInput,
  ObservabilityLogger,
} from "../../observability/event-logger.js";

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

// #390 — a repository template can gain a variable the hand-maintained
// Langfuse prompt never receives. The remote template still satisfies
// `requiredMarkers`/`orderedMarkers`, so it validates cleanly and is served
// with the new data reaching nothing. These tests pin the reporting signal:
// it names the gap and it NEVER changes what gets served.

/** `{{optional}}` is declared but is neither a required nor an ordered marker. */
const DRIFT_DEF: PromptDefinition = {
  name: "kinora-test-prompt",
  localTemplate: "LOCAL {{x}} {{optional}}",
  variables: ["x", "optional"],
  requiredMarkers: ["{{x}}"],
  orderedMarkers: ["{{x}}"],
  maxTemplateChars: 1000,
};

function buildObservability() {
  const events: ObservabilityEventInput[] = [];
  const logger: ObservabilityLogger = {
    recordEvent: (input) => {
      events.push(input);
    },
  };
  return { logger, events };
}

/** Every marker the template references, so nothing survives unresolved. */
function varsFor(def: PromptDefinition): Record<string, string> {
  return Object.fromEntries(
    [...templateVariablesOf(def.localTemplate), ...def.variables].map((name) => [
      name,
      `value-of-${name}`,
    ])
  );
}

describe("ResolvePrompt template-drift reporting", () => {
  it("reports drift AND still serves the remote template when a declared variable is absent", async () => {
    const { gateway } = buildGateway(async () => ({ template: "REMOTE {{x}}", version: 7 }));
    const { logger, events } = buildObservability();
    const useCase = new ResolvePrompt(gateway, { observability: logger });

    const resolution = await useCase.execute(DRIFT_DEF, { x: "42", optional: "ignored" });

    expect(resolution).toEqual({
      text: "REMOTE 42",
      source: "langfuse",
      name: DRIFT_DEF.name,
      version: 7,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: "warn",
      event: PROMPT_TEMPLATE_DRIFT_EVENT,
      outcome: "remote_missing_variables",
      metadata: {
        promptName: DRIFT_DEF.name,
        promptVersion: 7,
        missingVariables: "optional",
        missingVariableCount: 1,
      },
    });
  });

  it("reports nothing when the remote template references every declared variable", async () => {
    const { gateway } = buildGateway(async () => ({
      template: DRIFT_DEF.localTemplate,
      version: 1,
    }));
    const { logger, events } = buildObservability();
    const useCase = new ResolvePrompt(gateway, { observability: logger });

    const resolution = await useCase.execute(DRIFT_DEF, { x: "42", optional: "here" });

    expect(resolution.source).toBe("langfuse");
    expect(events).toEqual([]);
  });

  it("carries the prompt name and missing variable NAMES only — no template or user content", async () => {
    const { gateway } = buildGateway(async () => ({
      template: "SYSTEM PREAMBLE {{x}}",
      version: 2,
    }));
    const { logger, events } = buildObservability();
    const useCase = new ResolvePrompt(gateway, { observability: logger });

    await useCase.execute(DRIFT_DEF, { x: "user-secret-value", optional: "user-body-data" });

    const metadata = JSON.stringify(events[0]?.metadata);
    expect(metadata).toContain("optional");
    expect(metadata).not.toContain("SYSTEM PREAMBLE");
    expect(metadata).not.toContain("user-secret-value");
    expect(metadata).not.toContain("user-body-data");
    // A drift event is about a template, never about a person.
    expect(events[0]?.tenantId ?? null).toBeNull();
    expect(events[0]?.actorUserId ?? null).toBeNull();
  });

  it("reports no drift when the remote template was rejected and the local one is served", async () => {
    const { gateway } = buildGateway(async () => ({ template: "no required marker", version: 1 }));
    const { logger, events } = buildObservability();
    const useCase = new ResolvePrompt(gateway, { observability: logger, warn: vi.fn() });

    const resolution = await useCase.execute(DRIFT_DEF, { x: "42", optional: "here" });

    expect(resolution.source).toBe("fallback");
    expect(events).toEqual([]);
  });

  it("resolves normally when no observability logger is injected", async () => {
    const { gateway } = buildGateway(async () => ({ template: "REMOTE {{x}}", version: 1 }));
    const useCase = new ResolvePrompt(gateway);

    await expect(useCase.execute(DRIFT_DEF, { x: "42", optional: "here" })).resolves.toMatchObject({
      source: "langfuse",
    });
  });

  // The three prompts the repository owns. `kinora-plan-generation` is the
  // real 17c incident: `{{bodyProfileSection}}` is deliberately not a required
  // marker, so the stale hosted template validates. For the two chat prompts
  // every declared variable IS a required marker today, so the equivalent gap
  // is a definition that has just gained a variable the hosted template lacks.
  const REAL_CASES: ReadonlyArray<{ def: PromptDefinition; remote: string; missing: string }> = [
    {
      def: PLAN_PROMPT_DEFINITION,
      remote: PLAN_PROMPT_DEFINITION.localTemplate.replace("{{bodyProfileSection}}", ""),
      missing: "bodyProfileSection",
    },
    {
      def: { ...REPLY_PROMPT_DEFINITION, variables: [...REPLY_PROMPT_DEFINITION.variables, "newSection"] },
      remote: REPLY_PROMPT_DEFINITION.localTemplate,
      missing: "newSection",
    },
    {
      def: {
        ...EXTRACTION_PROMPT_DEFINITION,
        variables: [...EXTRACTION_PROMPT_DEFINITION.variables, "newSection"],
      },
      remote: EXTRACTION_PROMPT_DEFINITION.localTemplate,
      missing: "newSection",
    },
  ];

  for (const { def, remote, missing } of REAL_CASES) {
    it(`reports the gap for ${def.name} and still serves the remote template`, async () => {
      const { gateway } = buildGateway(async () => ({ template: remote, version: 5 }));
      const { logger, events } = buildObservability();
      const useCase = new ResolvePrompt(gateway, { observability: logger });

      const resolution = await useCase.execute(def, varsFor(def));

      expect(resolution.source).toBe("langfuse");
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toMatchObject({
        promptName: def.name,
        missingVariables: missing,
        missingVariableCount: 1,
      });
    });

    it(`reports nothing for ${def.name} when the hosted template matches the definition`, async () => {
      const complete: PromptDefinition = { ...def, variables: templateVariablesOf(remote) };
      const { gateway } = buildGateway(async () => ({ template: remote, version: 5 }));
      const { logger, events } = buildObservability();
      const useCase = new ResolvePrompt(gateway, { observability: logger });

      const resolution = await useCase.execute(complete, varsFor(complete));

      expect(resolution.source).toBe("langfuse");
      expect(events).toEqual([]);
    });
  }
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
