import type { SpeechTranscriber } from "./speech-transcriber-port.js";
import type { SpeechSynthesizer } from "./speech-synthesizer-port.js";
import { OpenAIAudioAdapter } from "./openai-audio-adapter.js";
import { GoogleSpeechTranscriber } from "./google-speech-transcriber.js";
import { GeminiSpeechSynthesizer } from "./gemini-speech-synthesizer.js";

/**
 * Env-driven voice provider selection (feat/voice-provider-adapters).
 *
 * Mirrors the chat's `buildAdapters()` provider abstraction, but WITHOUT the DB:
 * voice provider choice is a deploy-time env decision, not a per-tenant runtime
 * config. STT and TTS are selected INDEPENDENTLY so a deploy can, e.g., use
 * Google for transcription while keeping OpenAI for synthesis.
 *
 * Fail-safe: an unknown/unset provider value falls back to `openai` (the only
 * complete provider today), matching the chat factory's default behavior — a
 * misconfigured env can never leave voice with no adapter.
 *
 * PURE + LAZY: each call constructs a fresh adapter instance. The adapters read
 * their dedicated API keys at CALL time (inside `transcribe`/`synthesize`), so
 * building an instance here never touches a key or the network.
 */

/**
 * Build the STT transcriber from `VOICE_STT_PROVIDER`
 * (`openai` | `google`, default `openai`). Unknown → `openai` (fail-safe).
 */
export function buildTranscriber(): SpeechTranscriber {
  const provider = process.env["VOICE_STT_PROVIDER"];
  switch (provider) {
    case "google":
      return new GoogleSpeechTranscriber();
    case "openai":
    default:
      return new OpenAIAudioAdapter();
  }
}

/**
 * Build the TTS synthesizer from `VOICE_TTS_PROVIDER`
 * (`openai` | `google`, default `openai`). `google` → `GeminiSpeechSynthesizer`
 * (Gemini TTS, returns `audio/wav`), enabling a fully OpenAI-free voice stack
 * alongside `VOICE_STT_PROVIDER=google`. Unknown/unset → `openai` (fail-safe
 * back-compat — a misconfigured env can never leave voice with no adapter).
 */
export function buildSynthesizer(): SpeechSynthesizer {
  const provider = process.env["VOICE_TTS_PROVIDER"];
  switch (provider) {
    case "google":
      return new GeminiSpeechSynthesizer();
    case "openai":
    default:
      return new OpenAIAudioAdapter();
  }
}
