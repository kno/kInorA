import { describe, expect, it } from "vitest";
import type { PlanTraceMetadata } from "../trace-metadata.js";

describe("PlanTraceMetadata — the closed type over the one payload the mask hook cannot reach", () => {
  it("accepts the minimal fallback-path shape", () => {
    const metadata: PlanTraceMetadata = {
      feature: "plan-generation",
      provider: "openai",
      model: "gpt-4o-mini",
      promptSource: "fallback",
      promptLinked: false,
    };
    expect(metadata.promptSource).toBe("fallback");
  });

  it("accepts the full langfuse-linked shape", () => {
    const metadata: PlanTraceMetadata = {
      feature: "plan-chat-extraction",
      provider: "openai",
      model: "gpt-4o-mini",
      promptSource: "langfuse",
      promptLinked: true,
      promptName: "kinora-plan-generation",
      promptVersion: 5,
      promptLabel: "production",
      langfusePrompt: { name: "kinora-plan-generation", version: 5, isFallback: false },
    };
    expect(metadata.promptLinked).toBe(true);
  });

  it("rejects an excess weightKg key via TypeScript's excess-property check on an object literal", () => {
    // @ts-expect-error — weightKg is not a declared PlanTraceMetadata key.
    // This MUST fail type-check if the closed type is ever loosened: metadata
    // is the one channel the Langfuse `mask` hook does not reach, so a body
    // value here would bypass the entire redaction capability silently.
    const bad: PlanTraceMetadata = {
      feature: "plan-generation",
      provider: "openai",
      model: "gpt-4o-mini",
      promptSource: "fallback",
      promptLinked: false,
      weightKg: 68,
    };
    expect(bad).toBeDefined();
  });

  it("rejects any other body-metric-shaped excess key the same way", () => {
    // @ts-expect-error — heightCm is not a declared PlanTraceMetadata key.
    const bad: PlanTraceMetadata = {
      feature: "plan-generation",
      provider: "openai",
      model: "gpt-4o-mini",
      promptSource: "fallback",
      promptLinked: false,
      heightCm: 172,
    };
    expect(bad).toBeDefined();
  });
});
