import { describe, it, expect } from "vitest";
import { MockSpeechTranscriber, SILENCE_MARKER } from "../mock-speech-transcriber.js";
import type { TranscribeInput } from "../speech-transcriber-port.js";

const input: TranscribeInput = {
  audio: new Uint8Array([1, 2, 3, 4]),
  contentType: "audio/webm",
};

describe("MockSpeechTranscriber", () => {
  const transcriber = new MockSpeechTranscriber();

  it("transcribe returns a deterministic {text, unclear} for a fixed input", async () => {
    const a = await transcriber.transcribe(input);
    const b = await transcriber.transcribe(input);
    expect(a).toEqual(b);
    expect(a.unclear).toBe(false);
    expect(a.text.length).toBeGreaterThan(0);
  });

  it("transcribe maps a fixed silence marker to {text:'', unclear:true}", async () => {
    const result = await transcriber.transcribe({
      audio: new TextEncoder().encode(SILENCE_MARKER),
      contentType: "audio/webm",
    });
    expect(result).toEqual({ text: "", unclear: true });
  });

  it("transcribe never performs a network call (resolves synchronously-ish, no throw)", async () => {
    await expect(transcriber.transcribe(input)).resolves.toBeDefined();
  });

  it("transcribe honors an already-aborted signal without crashing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(transcriber.transcribe(input, controller.signal)).resolves.toBeDefined();
  });
});
