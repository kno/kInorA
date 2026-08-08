import { describe, it, expect } from "vitest";
import {
  validateRemoteTemplate,
  checkRenderedTemplate,
  missingRemoteVariables,
  RemoteTemplateSchema,
} from "../remote-template-validation.js";
import type { PromptDefinition } from "../prompt-template.js";

// Table-driven, one case per `PromptRejectionReason` the boundary validator
// owns (langfuse-prompt-management, slice B2). `no_credentials`,
// `fetch_failed` and `prompt_not_found` are provider-level reasons assigned
// by `ResolvePrompt` (`prompt-provider.ts`), not by this module.

const DEF: PromptDefinition = {
  name: "test-prompt",
  localTemplate: "{{a}}\n{{b}}\nTASK:\n{{c}}",
  variables: ["a", "b", "c"],
  requiredMarkers: ["{{a}}", "{{b}}", "TASK:"],
  orderedMarkers: ["{{a}}", "{{b}}", "TASK:"],
  maxTemplateChars: 100,
};

describe("validateRemoteTemplate", () => {
  it("accepts a template that matches the definition exactly", () => {
    expect(validateRemoteTemplate(DEF, DEF.localTemplate)).toEqual({
      ok: true,
      template: DEF.localTemplate,
    });
  });

  it("rejects a non-string payload — payload_not_string", () => {
    expect(validateRemoteTemplate(DEF, 42)).toEqual({
      ok: false,
      reason: "payload_not_string",
    });
  });

  it("rejects an empty-string payload — payload_empty", () => {
    expect(validateRemoteTemplate(DEF, "")).toEqual({ ok: false, reason: "payload_empty" });
  });

  it("rejects an over-size-cap payload — payload_too_large", () => {
    expect(validateRemoteTemplate(DEF, "x".repeat(101))).toEqual({
      ok: false,
      reason: "payload_too_large",
    });
  });

  it("rejects a template referencing an unknown variable — unknown_variable", () => {
    expect(validateRemoteTemplate(DEF, "{{a}}{{b}}{{nope}}TASK:{{c}}")).toEqual({
      ok: false,
      reason: "unknown_variable",
    });
  });

  it("rejects a template missing a required marker — missing_required_placeholder", () => {
    // Drops "{{b}}" — mirrors a fetched buildPlanPrompt template omitting the
    // #352 closed-vocabulary section placeholder.
    expect(validateRemoteTemplate(DEF, "{{a}}\nTASK:\n{{c}}")).toEqual({
      ok: false,
      reason: "missing_required_placeholder",
    });
  });

  it("rejects a template that relocates a required marker out of order — marker_order_violated, not repaired", () => {
    // "{{b}}" moved AFTER "TASK:" — mirrors the #352 closed-vocabulary section
    // being relocated so the task-block reference to it no longer resolves.
    const relocated = "{{a}}\nTASK:\n{{b}}\n{{c}}";
    const result = validateRemoteTemplate(DEF, relocated);
    expect(result).toEqual({ ok: false, reason: "marker_order_violated" });
    // The whole template is rejected — never reordered or repaired.
    expect(result).not.toHaveProperty("template");
  });
});

describe("checkRenderedTemplate", () => {
  it("passes when the rendered output has no residual marker", () => {
    expect(checkRenderedTemplate("fully rendered text")).toEqual({ ok: true });
  });

  it("rejects a rendered output with an unresolved {{ sequence — unresolved_marker_after_render", () => {
    expect(checkRenderedTemplate("still has {{ residual")).toEqual({
      ok: false,
      reason: "unresolved_marker_after_render",
    });
  });
});

describe("missingRemoteVariables", () => {
  it("returns nothing when the template references every declared variable", () => {
    expect(missingRemoteVariables(DEF, DEF.localTemplate)).toEqual([]);
  });

  it("names a declared variable the template never references", () => {
    // `{{c}}` is declared but is neither a required nor an ordered marker, so
    // a template omitting it validates cleanly — exactly the silent gap.
    const remote = "{{a}}\n{{b}}\nTASK:";
    expect(validateRemoteTemplate(DEF, remote).ok).toBe(true);
    expect(missingRemoteVariables(DEF, remote)).toEqual(["c"]);
  });

  it("reports every missing variable in the definition's declared order", () => {
    expect(missingRemoteVariables(DEF, "TASK:")).toEqual(["a", "b", "c"]);
  });

  it("ignores markers the template references but the definition does not declare", () => {
    expect(missingRemoteVariables(DEF, `${DEF.localTemplate}\n{{extra}}`)).toEqual([]);
  });
});

describe("RemoteTemplateSchema", () => {
  it("builds a zod schema honoring the definition's maxTemplateChars", () => {
    const schema = RemoteTemplateSchema(DEF);
    expect(schema.safeParse("ok").success).toBe(true);
    expect(schema.safeParse("x".repeat(101)).success).toBe(false);
  });
});
