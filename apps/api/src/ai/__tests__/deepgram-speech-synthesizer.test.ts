import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DeepgramSpeechSynthesizer,
  type DeepgramFetch,
} from "../deepgram-speech-synthesizer.js";
import { ProviderRateLimitError } from "../provider-errors.js";

/**
 * The adapter is constructed with an injectable `fetch`-shaped client so tests
 * never touch the network. Each fake records the URL + init it was called with
 * and returns a canned `/v1/speak` response whose body IS raw audio bytes
 * (exposed via `arrayBuffer()`).
 */
function makeFakeFetch(
  audioBytes: Uint8Array,
  opts?: { status?: number },
): {
  fetchImpl: DeepgramFetch;
  calls: Array<{ url: string; init: Parameters<DeepgramFetch>[1] }>;
} {
  const calls: Array<{ url: string; init: Parameters<DeepgramFetch>[1] }> = [];
  const fetchImpl: DeepgramFetch = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return {
      status: opts?.status ?? 200,
      arrayBuffer: async () =>
        audioBytes.buffer.slice(
          audioBytes.byteOffset,
          audioBytes.byteOffset + audioBytes.byteLength,
        ) as ArrayBuffer,
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
  audioBytes: Uint8Array,
): {
  fetchImpl: DeepgramFetch;
  calls: Array<{ url: string; init: Parameters<DeepgramFetch>[1] }>;
} {
  const calls: Array<{ url: string; init: Parameters<DeepgramFetch>[1] }> = [];
  let callIndex = 0;
  const fetchImpl: DeepgramFetch = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(callIndex, statuses.length - 1)]!;
    callIndex += 1;
    return {
      status,
      arrayBuffer: async () =>
        audioBytes.buffer.slice(
          audioBytes.byteOffset,
          audioBytes.byteOffset + audioBytes.byteLength,
        ) as ArrayBuffer,
    };
  });
  return { fetchImpl, calls };
}

/** A known WAV-ish byte payload — the adapter returns it verbatim. */
const WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

describe("DeepgramSpeechSynthesizer — synthesize", () => {
  const OLD_KEY = process.env["DEEPGRAM_API_KEY"];
  const OLD_MODEL = process.env["DEEPGRAM_TTS_MODEL"];

  beforeEach(() => {
    process.env["DEEPGRAM_API_KEY"] = "deepgram-test-key";
    delete process.env["DEEPGRAM_TTS_MODEL"];
  });

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env["DEEPGRAM_API_KEY"];
    else process.env["DEEPGRAM_API_KEY"] = OLD_KEY;
    if (OLD_MODEL === undefined) delete process.env["DEEPGRAM_TTS_MODEL"];
    else process.env["DEEPGRAM_TTS_MODEL"] = OLD_MODEL;
    vi.restoreAllMocks();
  });

  it("builds a /v1/speak request with the default voice model + encoding params, Token auth, JSON {text} body, and returns the audio bytes as audio/wav", async () => {
    const { fetchImpl, calls } = makeFakeFetch(WAV_BYTES);
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl);

    const result = await adapter.synthesize("¡Buen plan! Empecemos.");

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;

    // Endpoint + default voice model + audio-format query params.
    expect(url).toContain("api.deepgram.com/v1/speak");
    expect(url).toContain("model=aura-2-carina-es");
    expect(url).toContain("encoding=linear16");
    expect(url).toContain("sample_rate=24000");
    expect(url).toContain("container=wav");

    expect(init.method).toBe("POST");
    // Deepgram `Authorization: Token <key>` scheme + JSON content type.
    expect(init.headers["Authorization"]).toBe("Token deepgram-test-key");
    expect(init.headers["Content-Type"]).toBe("application/json");

    // JSON body carries only the text.
    const body = JSON.parse(init.body) as { text: string };
    expect(body.text).toBe("¡Buen plan! Empecemos.");

    // The response body bytes are returned verbatim as audio/wav.
    expect(result.contentType).toBe("audio/wav");
    expect(Array.from(result.audio)).toEqual(Array.from(WAV_BYTES));
  });

  it("uses DEEPGRAM_TTS_MODEL when set (voice swap is a config change)", async () => {
    process.env["DEEPGRAM_TTS_MODEL"] = "aura-2-nestor-es";
    const { fetchImpl, calls } = makeFakeFetch(WAV_BYTES);
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl);

    await adapter.synthesize("hola");

    expect(calls[0]!.url).toContain("model=aura-2-nestor-es");
    expect(calls[0]!.url).not.toContain("aura-2-carina-es");
  });

  it("truncates text over 2000 chars at a sentence boundary", async () => {
    // First sentence ends well within the cap; a huge run follows. The bounded
    // text must end at that boundary and never exceed the 2000-char cap.
    const firstSentence = `${"a".repeat(1500)}.`;
    const longText = `${firstSentence}${"b".repeat(3000)}.`;
    const { fetchImpl, calls } = makeFakeFetch(WAV_BYTES);
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl);

    await adapter.synthesize(longText);

    const body = JSON.parse(calls[0]!.init.body) as { text: string };
    expect(body.text.length).toBeLessThanOrEqual(2000);
    expect(body.text.length).toBeGreaterThan(0);
    // Cut at the first sentence's terminating period.
    expect(body.text).toBe(firstSentence);
  });

  it("reads DEEPGRAM_API_KEY at call time, not at construction", async () => {
    delete process.env["DEEPGRAM_API_KEY"];
    const { fetchImpl, calls } = makeFakeFetch(WAV_BYTES);
    // Construction must not observe the key at all.
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl);
    expect(calls).toHaveLength(0);

    process.env["DEEPGRAM_API_KEY"] = "late-key";
    await adapter.synthesize("hi");

    expect(calls[0]!.init.headers["Authorization"]).toBe("Token late-key");
  });

  it("honors an already-aborted signal: throws WITHOUT calling fetch", async () => {
    const { fetchImpl, calls } = makeFakeFetch(WAV_BYTES);
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl);
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.synthesize("hi", controller.signal)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("forwards an AbortSignal into the fetch init", async () => {
    const { fetchImpl, calls } = makeFakeFetch(WAV_BYTES);
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl);
    const controller = new AbortController();

    await adapter.synthesize("hi", controller.signal);

    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws when the response contains no audio (fail-closed → route 502)", async () => {
    const { fetchImpl } = makeFakeFetch(new Uint8Array(0));
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl);

    await expect(adapter.synthesize("hi")).rejects.toThrow("no audio");
  });

  it("a TERMINAL 429 (retries exhausted) throws ProviderRateLimitError('deepgram','tts'), not the generic error", async () => {
    const { fetchImpl } = makeFakeFetch(WAV_BYTES, { status: 429 });
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.synthesize("hi");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ProviderRateLimitError);
    expect((caught as ProviderRateLimitError).provider).toBe("deepgram");
    expect((caught as ProviderRateLimitError).feature).toBe("tts");
    const serialized = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(serialized).not.toContain("deepgram-test-key");
  });

  it("throws a generic error with the status on a non-200 (non-429) response without leaking the key or text", async () => {
    const { fetchImpl } = makeFakeFetch(WAV_BYTES, { status: 400 });
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.synthesize("secret user text");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ProviderRateLimitError);
    const message = (caught as Error).message;
    expect(message).toContain("400");
    const serialized = `${message}\n${(caught as Error).stack ?? ""}`;
    expect(serialized).not.toContain("deepgram-test-key");
    expect(serialized).not.toContain("secret user text");
  });

  it("retries a transient 503 and succeeds on the following 200 (zeroed backoff)", async () => {
    const { fetchImpl, calls } = makeSequencedFetch([503, 200], WAV_BYTES);
    const adapter = new DeepgramSpeechSynthesizer(fetchImpl, [0, 0]);

    const result = await adapter.synthesize("hello");

    expect(result.contentType).toBe("audio/wav");
    expect(Array.from(result.audio)).toEqual(Array.from(WAV_BYTES));
    expect(calls).toHaveLength(2);
  });
});
