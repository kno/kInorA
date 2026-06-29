import { describe, it, expect, vi, afterEach } from "vitest";
import { warnIfAiConfigMissing } from "../openrouter-generator.js";

describe("warnIfAiConfigMissing", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    consoleWarnSpy?.mockRestore();
  });

  it("emits a console.warn containing OPENROUTER_API_KEY when the key is absent", () => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfAiConfigMissing({});

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const [msg] = consoleWarnSpy.mock.calls[0] as [string];
    expect(msg).toContain("OPENROUTER_API_KEY");
  });

  it("emits a console.warn containing [startup] when the key is absent", () => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfAiConfigMissing({});

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const [msg] = consoleWarnSpy.mock.calls[0] as [string];
    expect(msg).toContain("[startup]");
  });

  it("does NOT emit console.warn when OPENROUTER_API_KEY is set", () => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfAiConfigMissing({ OPENROUTER_API_KEY: "sk-test-key" });

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("does NOT emit console.warn when the key is whitespace only (empty after trim)", () => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Whitespace-only should be treated as absent
    warnIfAiConfigMissing({ OPENROUTER_API_KEY: "   " });

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});
