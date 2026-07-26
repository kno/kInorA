import type {
  SpeechSynthesizer,
  SynthesizeResult,
} from "./speech-synthesizer-port.js";

/**
 * Deterministic mock implementation of `SpeechSynthesizer` (mirrors
 * `MockSpeechTranscriber`).
 *
 * Returns deterministic `{ audio, contentType: "audio/mpeg" }` bytes derived
 * from the input text WITHOUT any network call, API key, or `openai`
 * dependency — used by route/integration tests that need a synthesizer without
 * real audio infrastructure. It intentionally does NOT import the `openai` SDK;
 * the real adapter (`OpenAIAudioAdapter`) owns that dependency.
 *
 * Determinism guarantee: same input text → same output bytes on every call,
 * from any instance. The bytes are a UTF-8 encoding of a fixed prefix plus the
 * text so a test can assert playback of a stable, non-empty payload.
 */
const encoder = new TextEncoder();

/** Fixed prefix so the mock payload is recognizable and never empty. */
const MOCK_AUDIO_PREFIX = "MOCK-MP3:";

export class MockSpeechSynthesizer implements SpeechSynthesizer {
  async synthesize(text: string, _signal?: AbortSignal): Promise<SynthesizeResult> {
    const audio = encoder.encode(`${MOCK_AUDIO_PREFIX}${text}`);
    return { audio, contentType: "audio/mpeg" };
  }
}
