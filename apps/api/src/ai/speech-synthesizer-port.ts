/**
 * Hexagonal port for text-to-speech synthesis (13-v1.1-interactive-voice-chat, A3).
 *
 * Mirrors `SpeechTranscriber` (`speech-transcriber-port.ts`): the route boundary
 * depends ONLY on this interface, never on the `openai` SDK. Implementors:
 * - `OpenAIAudioAdapter` (A3) — real OpenAI TTS (`gpt-4o-mini-tts`, voice `alloy`,
 *   `mp3`) via the `openai` SDK; reads the dedicated `OPENAI_API_KEY` at call time.
 * - `MockSpeechSynthesizer` (A3) — deterministic, no network; used by route and
 *   integration tests.
 *
 * Contract (design.md — "TTS = gpt-4o-mini-tts, mp3, play-after-turn"):
 * - `synthesize` converts the terminal `assistantMessage` text to audio bytes
 *   in-flight and MUST NEVER persist the generated audio (no storage, logs, or
 *   observability). The text and the dedicated key MUST NEVER be logged.
 * - The output is always `audio/mpeg` (mp3) for the broadest `<audio>` + Expo
 *   playback support.
 * - The optional `AbortSignal` MUST be honored (client disconnect / timeout).
 *
 * No external imports — this is the boundary layer; adapters own the SDK
 * dependency (deps-guard confines `openai` to `apps/api`).
 */
export interface SynthesizeResult {
  /** In-flight audio bytes ONLY — never persisted. */
  audio: Uint8Array;
  /** Always mp3 in v1. */
  contentType: "audio/mpeg";
}

export interface SpeechSynthesizer {
  synthesize(text: string, signal?: AbortSignal): Promise<SynthesizeResult>;
}
