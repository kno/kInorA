import { describe, it, expect } from "vitest";
import { MockSpeechSynthesizer } from "../mock-speech-synthesizer.js";

describe("MockSpeechSynthesizer", () => {
  it("returns deterministic { audio, contentType: 'audio/mpeg' } for a fixed input (no network)", async () => {
    const synth = new MockSpeechSynthesizer();

    const a = await synth.synthesize("great, four days a week with dumbbells");
    const b = await synth.synthesize("great, four days a week with dumbbells");

    expect(a.contentType).toBe("audio/mpeg");
    expect(a.audio).toBeInstanceOf(Uint8Array);
    expect(a.audio.byteLength).toBeGreaterThan(0);
    // Determinism: same input → byte-identical output, from any instance.
    expect(Buffer.from(a.audio).equals(Buffer.from(b.audio))).toBe(true);
    const other = await new MockSpeechSynthesizer().synthesize(
      "great, four days a week with dumbbells",
    );
    expect(Buffer.from(a.audio).equals(Buffer.from(other.audio))).toBe(true);
  });

  it("produces different bytes for different text", async () => {
    const synth = new MockSpeechSynthesizer();
    const a = await synth.synthesize("hello");
    const b = await synth.synthesize("world");
    expect(Buffer.from(a.audio).equals(Buffer.from(b.audio))).toBe(false);
  });
});
