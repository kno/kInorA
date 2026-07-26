/**
 * Hexagonal port for speech-to-text transcription (13-v1.1-interactive-voice-chat).
 *
 * Mirrors `PlanSpecExtractor` (`extraction-port.ts`) and `PlanGenerator`
 * (`port.ts`): the route boundary depends ONLY on this interface, never on the
 * `openai` SDK. Implementors:
 * - `OpenAIAudioAdapter` (A1) — real Whisper (`whisper-1`) transcription via the
 *   `openai` SDK; reads a dedicated `OPENAI_API_KEY` at call time.
 * - `MockSpeechTranscriber` (A1) — deterministic, no network; used by route and
 *   integration tests.
 *
 * Contract (design.md — "Graceful could not understand"):
 * - `transcribe` runs the audio blob in-flight and MUST NEVER persist the raw
 *   audio (no storage, logs, or observability).
 * - Silence / noise / an empty or whitespace-only transcript maps to
 *   `{ text: "", unclear: true }` — a normal user event, not an error.
 * - The optional `AbortSignal` MUST be honored (client disconnect / timeout).
 *
 * No external imports — this is the boundary layer; adapters own the SDK
 * dependency (deps-guard confines `openai` to `apps/api`).
 */
export interface TranscribeInput {
  /** In-flight audio bytes ONLY — never persisted. */
  audio: Uint8Array;
  /** Validated against the route allow-list before reaching the adapter. */
  contentType: string;
  /** Optional EN/ES hint derived from the request locale (Whisper autodetects). */
  language?: string;
}

export interface TranscribeResult {
  /** "" when the recording is unintelligible (silence / noise). */
  text: string;
  /** true on silence / noise / an empty transcript. */
  unclear: boolean;
}

export interface SpeechTranscriber {
  transcribe(input: TranscribeInput, signal?: AbortSignal): Promise<TranscribeResult>;
}
