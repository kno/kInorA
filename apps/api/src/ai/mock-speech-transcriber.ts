import type {
  SpeechTranscriber,
  TranscribeInput,
  TranscribeResult,
} from "./speech-transcriber-port.js";

/**
 * Deterministic mock implementation of `SpeechTranscriber` (mirrors
 * `MockPlanSpecExtractor`).
 *
 * Returns a canned `{ text, unclear }` WITHOUT any network call, API key, or
 * `openai` dependency — used by route/integration tests that need a transcriber
 * without real audio infrastructure. It intentionally does NOT import the
 * `openai` SDK; the real adapter (`OpenAIAudioAdapter`) owns that dependency.
 *
 * Determinism guarantee: same input → same output on every call, from any
 * instance. Audio bytes matching `SILENCE_MARKER` map to the "could not
 * understand" result so tests can exercise the silence/noise taxonomy without a
 * real recording.
 */

/** Bytes matching this decoded marker yield `{ text: "", unclear: true }`. */
export const SILENCE_MARKER = "__SILENCE__";

/** Deterministic transcript returned for any non-silence input. */
const CANNED_TRANSCRIPT = "build muscle four days a week with just dumbbells";

const decoder = new TextDecoder();

export class MockSpeechTranscriber implements SpeechTranscriber {
  constructor(private readonly transcript: string = CANNED_TRANSCRIPT) {}

  async transcribe(input: TranscribeInput, _signal?: AbortSignal): Promise<TranscribeResult> {
    let decoded = "";
    try {
      decoded = decoder.decode(input.audio);
    } catch {
      decoded = "";
    }

    if (decoded === SILENCE_MARKER) {
      return { text: "", unclear: true };
    }

    return { text: this.transcript, unclear: this.transcript.trim().length === 0 };
  }
}
