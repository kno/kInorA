import { describe, it, expect } from "vitest";
import { ProviderRateLimitError } from "../provider-errors.js";

describe("ProviderRateLimitError", () => {
  it("carries provider + feature and a fixed, generic message", () => {
    const err = new ProviderRateLimitError("gemini", "stt");

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ProviderRateLimitError");
    expect(err.provider).toBe("gemini");
    expect(err.feature).toBe("stt");
    expect(err.message).toBe("gemini rate limit / quota exceeded");
  });

  it("never embeds a key, prompt, or audio in the message", () => {
    const err = new ProviderRateLimitError("gemini", "tts");
    expect(err.message).not.toMatch(/key|prompt|audio/i);
  });
});
