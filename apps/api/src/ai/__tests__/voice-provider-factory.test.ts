import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTranscriber, buildSynthesizer } from "../voice-provider-factory.js";
import { OpenAIAudioAdapter } from "../openai-audio-adapter.js";
import { GoogleSpeechTranscriber } from "../google-speech-transcriber.js";
import { DeepgramSpeechTranscriber } from "../deepgram-speech-transcriber.js";
import { GeminiSpeechSynthesizer } from "../gemini-speech-synthesizer.js";

describe("voice-provider-factory — buildTranscriber", () => {
  const OLD = process.env["VOICE_STT_PROVIDER"];

  afterEach(() => {
    if (OLD === undefined) delete process.env["VOICE_STT_PROVIDER"];
    else process.env["VOICE_STT_PROVIDER"] = OLD;
  });

  it("returns an OpenAIAudioAdapter when VOICE_STT_PROVIDER is unset (back-compat default)", () => {
    delete process.env["VOICE_STT_PROVIDER"];
    expect(buildTranscriber()).toBeInstanceOf(OpenAIAudioAdapter);
  });

  it("returns an OpenAIAudioAdapter for VOICE_STT_PROVIDER=openai", () => {
    process.env["VOICE_STT_PROVIDER"] = "openai";
    expect(buildTranscriber()).toBeInstanceOf(OpenAIAudioAdapter);
  });

  it("returns a GoogleSpeechTranscriber for VOICE_STT_PROVIDER=google", () => {
    process.env["VOICE_STT_PROVIDER"] = "google";
    expect(buildTranscriber()).toBeInstanceOf(GoogleSpeechTranscriber);
  });

  it("returns a DeepgramSpeechTranscriber for VOICE_STT_PROVIDER=deepgram", () => {
    process.env["VOICE_STT_PROVIDER"] = "deepgram";
    expect(buildTranscriber()).toBeInstanceOf(DeepgramSpeechTranscriber);
  });

  it("falls back to OpenAIAudioAdapter for an unknown provider value (fail-safe)", () => {
    process.env["VOICE_STT_PROVIDER"] = "bogus-provider";
    expect(buildTranscriber()).toBeInstanceOf(OpenAIAudioAdapter);
  });
});

describe("voice-provider-factory — buildSynthesizer", () => {
  const OLD = process.env["VOICE_TTS_PROVIDER"];

  afterEach(() => {
    if (OLD === undefined) delete process.env["VOICE_TTS_PROVIDER"];
    else process.env["VOICE_TTS_PROVIDER"] = OLD;
  });

  beforeEach(() => {
    delete process.env["VOICE_TTS_PROVIDER"];
  });

  it("returns an OpenAIAudioAdapter when VOICE_TTS_PROVIDER is unset", () => {
    expect(buildSynthesizer()).toBeInstanceOf(OpenAIAudioAdapter);
  });

  it("returns an OpenAIAudioAdapter for VOICE_TTS_PROVIDER=openai", () => {
    process.env["VOICE_TTS_PROVIDER"] = "openai";
    expect(buildSynthesizer()).toBeInstanceOf(OpenAIAudioAdapter);
  });

  it("returns a GeminiSpeechSynthesizer for VOICE_TTS_PROVIDER=google", () => {
    process.env["VOICE_TTS_PROVIDER"] = "google";
    expect(buildSynthesizer()).toBeInstanceOf(GeminiSpeechSynthesizer);
  });

  it("falls back to OpenAIAudioAdapter for an unknown provider value (fail-safe)", () => {
    process.env["VOICE_TTS_PROVIDER"] = "bogus-provider";
    expect(buildSynthesizer()).toBeInstanceOf(OpenAIAudioAdapter);
  });
});
