import { describe, it, expect } from "vitest";
import { PromptNotFoundError } from "../prompt-source-port.js";

// `LangfusePromptGateway`/`PromptResolution` are structural interfaces (no
// runtime behavior to test). `PromptNotFoundError` is the one runtime symbol
// this module owns — the gateway adapter throws it to distinguish a missing
// prompt from a generic fetch failure, and `ResolvePrompt` maps it to the
// `prompt_not_found` reason code.

describe("PromptNotFoundError", () => {
  it("carries the prompt name in its message and a stable name for reason-code mapping", () => {
    const error = new PromptNotFoundError("kinora-plan-generation");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PromptNotFoundError");
    expect(error.message).toContain("kinora-plan-generation");
  });
});
