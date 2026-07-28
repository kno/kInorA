import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GeminiSpeechSynthesizer,
  wrapPcmInWavHeader,
  parseSampleRate,
  type GoogleGenAiFetch,
} from "../gemini-speech-synthesizer.js";

/**
 * The adapter is constructed with an injectable `fetch`-shaped client so tests
 * never touch the network. Each fake records the URL + init it was called with
 * and returns a canned `generateContent` TTS response body.
 */
function makeFakeFetch(
  responseBody: unknown,
  opts?: { status?: number },
): {
  fetchImpl: GoogleGenAiFetch;
  calls: Array<{ url: string; init: Parameters<GoogleGenAiFetch>[1] }>;
} {
  const calls: Array<{ url: string; init: Parameters<GoogleGenAiFetch>[1] }> = [];
  const fetchImpl: GoogleGenAiFetch = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return {
      status: opts?.status ?? 200,
      json: async () => responseBody,
    };
  });
  return { fetchImpl, calls };
}

/**
 * A fake fetch that returns a scripted sequence of statuses (one per call),
 * repeating the last entry once the sequence is exhausted. Used to prove the
 * shared transient-error retry (`retry-transient.ts`) is wired in.
 */
function makeSequencedFetch(
  statuses: number[],
  responseBody: unknown,
): {
  fetchImpl: GoogleGenAiFetch;
  calls: Array<{ url: string; init: Parameters<GoogleGenAiFetch>[1] }>;
} {
  const calls: Array<{ url: string; init: Parameters<GoogleGenAiFetch>[1] }> = [];
  let callIndex = 0;
  const fetchImpl: GoogleGenAiFetch = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(callIndex, statuses.length - 1)]!;
    callIndex += 1;
    return {
      status,
      json: async () => responseBody,
    };
  });
  return { fetchImpl, calls };
}

/** Build a Gemini TTS success body carrying inline base64 PCM + a mime type. */
function geminiAudioResponse(base64: string, mimeType?: string): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: base64,
                mimeType: mimeType ?? "audio/L16;codec=pcm;rate=24000",
              },
            },
          ],
        },
      },
    ],
  };
}

/** A known 6-byte PCM payload (3 mono 16-bit samples) as raw bytes + base64. */
const PCM_BYTES = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
const PCM_BASE64 = Buffer.from(PCM_BYTES).toString("base64");

/** Read a little-endian ASCII tag of length 4 from a byte array. */
function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + 4));
}

function u32le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true,
  );
}

function u16le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset,
    true,
  );
}

describe("wrapPcmInWavHeader (pure)", () => {
  it("produces a canonical 44-byte WAV header for mono/16-bit PCM", () => {
    const wav = wrapPcmInWavHeader(PCM_BYTES, 24000);

    expect(wav.byteLength).toBe(44 + PCM_BYTES.byteLength);
    expect(tag(wav, 0)).toBe("RIFF");
    expect(u32le(wav, 4)).toBe(36 + PCM_BYTES.byteLength); // ChunkSize
    expect(tag(wav, 8)).toBe("WAVE");
    expect(tag(wav, 12)).toBe("fmt ");
    expect(u32le(wav, 16)).toBe(16); // Subchunk1Size
    expect(u16le(wav, 20)).toBe(1); // AudioFormat = PCM
    expect(u16le(wav, 22)).toBe(1); // NumChannels = mono
    expect(u32le(wav, 24)).toBe(24000); // SampleRate
    expect(u32le(wav, 28)).toBe(24000 * 2); // ByteRate = rate * blockAlign
    expect(u16le(wav, 32)).toBe(2); // BlockAlign = 2
    expect(u16le(wav, 34)).toBe(16); // BitsPerSample
    expect(tag(wav, 36)).toBe("data");
    expect(u32le(wav, 40)).toBe(PCM_BYTES.byteLength); // Subchunk2Size == pcmLen
    // PCM payload copied verbatim after the header.
    expect(Array.from(wav.slice(44))).toEqual(Array.from(PCM_BYTES));
  });

  it("reflects a non-default sample rate in SampleRate + ByteRate", () => {
    const wav = wrapPcmInWavHeader(PCM_BYTES, 16000);
    expect(u32le(wav, 24)).toBe(16000);
    expect(u32le(wav, 28)).toBe(16000 * 2);
  });
});

describe("parseSampleRate (pure)", () => {
  it("parses rate=NNNN from the Gemini L16 mime type", () => {
    expect(parseSampleRate("audio/L16;codec=pcm;rate=24000")).toBe(24000);
    expect(parseSampleRate("audio/L16;codec=pcm;rate=16000")).toBe(16000);
  });

  it("defaults to 24000 when absent / malformed", () => {
    expect(parseSampleRate(undefined)).toBe(24000);
    expect(parseSampleRate("audio/L16;codec=pcm")).toBe(24000);
    expect(parseSampleRate("audio/L16;rate=abc")).toBe(24000);
  });
});

describe("GeminiSpeechSynthesizer — synthesize", () => {
  const OLD_KEY = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  const OLD_MODEL = process.env["GOOGLE_TTS_MODEL"];
  const OLD_VOICE = process.env["GOOGLE_TTS_VOICE"];

  beforeEach(() => {
    process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = "google-test-key";
    delete process.env["GOOGLE_TTS_MODEL"];
    delete process.env["GOOGLE_TTS_VOICE"];
  });

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
    else process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = OLD_KEY;
    if (OLD_MODEL === undefined) delete process.env["GOOGLE_TTS_MODEL"];
    else process.env["GOOGLE_TTS_MODEL"] = OLD_MODEL;
    if (OLD_VOICE === undefined) delete process.env["GOOGLE_TTS_VOICE"];
    else process.env["GOOGLE_TTS_VOICE"] = OLD_VOICE;
    vi.restoreAllMocks();
  });

  it("builds a generateContent request with the model + key in the URL and AUDIO modality + speechConfig voice + the text", async () => {
    const { fetchImpl, calls } = makeFakeFetch(geminiAudioResponse(PCM_BASE64));
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);

    await adapter.synthesize("Great plan! Let's begin.");

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;

    // Default model + key in the URL.
    expect(url).toContain("gemini-2.5-flash-preview-tts");
    expect(url).toContain(":generateContent");
    expect(url).toContain("key=google-test-key");
    expect(url).toContain("generativelanguage.googleapis.com");

    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      contents: Array<{ parts: Array<{ text?: string }> }>;
      generationConfig?: {
        responseModalities?: string[];
        speechConfig?: {
          voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } };
        };
      };
    };

    // AUDIO modality + default prebuilt voice + the text passed through.
    expect(body.generationConfig?.responseModalities).toEqual(["AUDIO"]);
    expect(
      body.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig
        ?.voiceName,
    ).toBe("Kore");
    expect(body.contents[0]!.parts[0]!.text).toBe("Great plan! Let's begin.");
  });

  it("uses GOOGLE_TTS_MODEL + GOOGLE_TTS_VOICE when set", async () => {
    process.env["GOOGLE_TTS_MODEL"] = "gemini-3.0-tts";
    process.env["GOOGLE_TTS_VOICE"] = "Puck";
    const { fetchImpl, calls } = makeFakeFetch(geminiAudioResponse(PCM_BASE64));
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);

    await adapter.synthesize("hi");

    expect(calls[0]!.url).toContain("gemini-3.0-tts");
    const body = JSON.parse(calls[0]!.init.body as string) as {
      generationConfig: {
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
      };
    };
    expect(
      body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    ).toBe("Puck");
  });

  it("decodes the inline base64 PCM and returns a valid WAV with audio/wav", async () => {
    const { fetchImpl } = makeFakeFetch(geminiAudioResponse(PCM_BASE64));
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);

    const result = await adapter.synthesize("hello");

    expect(result.contentType).toBe("audio/wav");

    const wav = result.audio;
    // Header identity.
    expect(tag(wav, 0)).toBe("RIFF");
    expect(tag(wav, 8)).toBe("WAVE");
    expect(tag(wav, 12)).toBe("fmt ");
    expect(u16le(wav, 20)).toBe(1); // PCM
    expect(u16le(wav, 22)).toBe(1); // mono
    expect(u16le(wav, 34)).toBe(16); // 16-bit
    expect(u32le(wav, 24)).toBe(24000); // parsed default rate
    expect(tag(wav, 36)).toBe("data");
    // data chunk length == PCM byte length, total == 44 + pcmLen.
    expect(u32le(wav, 40)).toBe(PCM_BYTES.byteLength);
    expect(wav.byteLength).toBe(44 + PCM_BYTES.byteLength);
    // PCM payload preserved.
    expect(Array.from(wav.slice(44))).toEqual(Array.from(PCM_BYTES));
  });

  it("parses a non-default rate from the mimeType into the WAV header", async () => {
    const { fetchImpl } = makeFakeFetch(
      geminiAudioResponse(PCM_BASE64, "audio/L16;codec=pcm;rate=16000"),
    );
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);

    const result = await adapter.synthesize("hello");

    expect(u32le(result.audio, 24)).toBe(16000); // SampleRate
    expect(u32le(result.audio, 28)).toBe(16000 * 2); // ByteRate
  });

  it("reads GOOGLE_GENERATIVE_AI_API_KEY at call time, not at construction", async () => {
    delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
    const { fetchImpl, calls } = makeFakeFetch(geminiAudioResponse(PCM_BASE64));
    // Construction must not observe the key at all.
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);
    expect(calls).toHaveLength(0);

    process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = "late-key";
    await adapter.synthesize("hi");

    expect(calls[0]!.url).toContain("key=late-key");
  });

  it("honors an already-aborted signal: throws WITHOUT calling fetch", async () => {
    const { fetchImpl, calls } = makeFakeFetch(geminiAudioResponse(PCM_BASE64));
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.synthesize("hi", controller.signal)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("forwards an AbortSignal into the fetch init", async () => {
    const { fetchImpl, calls } = makeFakeFetch(geminiAudioResponse(PCM_BASE64));
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);
    const controller = new AbortController();

    await adapter.synthesize("hi", controller.signal);

    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a generic error on a non-200 response without leaking the key", async () => {
    const { fetchImpl } = makeFakeFetch(
      { error: { message: "bad request" } },
      { status: 400 },
    );
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);

    await expect(adapter.synthesize("hi")).rejects.toThrow();

    let caught: unknown;
    try {
      await adapter.synthesize("hi");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const serialized = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(serialized).not.toContain("google-test-key");
  });

  it("throws when the response contains no audio (fail-closed → route 502)", async () => {
    const { fetchImpl } = makeFakeFetch({
      candidates: [{ content: { parts: [] } }],
    });
    const adapter = new GeminiSpeechSynthesizer(fetchImpl);

    await expect(adapter.synthesize("hi")).rejects.toThrow();
  });

  it("retries a transient 503 and succeeds on the following 200 (zeroed backoff)", async () => {
    const { fetchImpl, calls } = makeSequencedFetch(
      [503, 200],
      geminiAudioResponse(PCM_BASE64),
    );
    const adapter = new GeminiSpeechSynthesizer(fetchImpl, [0, 0]);

    const result = await adapter.synthesize("hello");

    expect(result.contentType).toBe("audio/wav");
    expect(calls).toHaveLength(2);
  });

  it("does not retry a non-transient 400 and throws immediately without leaking the key", async () => {
    const { fetchImpl, calls } = makeFakeFetch(
      { error: { message: "bad request" } },
      { status: 400 },
    );
    const adapter = new GeminiSpeechSynthesizer(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.synthesize("hi");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    const serialized = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(serialized).not.toContain("google-test-key");
    expect(calls).toHaveLength(1);
  });
});
