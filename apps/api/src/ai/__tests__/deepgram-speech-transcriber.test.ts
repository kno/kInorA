import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DeepgramSpeechTranscriber,
  type DeepgramFetch,
} from "../deepgram-speech-transcriber.js";
import type { TranscribeInput } from "../speech-transcriber-port.js";
import { ProviderRateLimitError } from "../provider-errors.js";

/**
 * The adapter is constructed with an injectable `fetch`-shaped client so tests
 * never touch the network. Each fake records the URL + init it was called with
 * and returns a canned Deepgram prerecorded response body.
 */
function makeFakeFetch(
  responseBody: unknown,
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
      json: async () => responseBody,
    };
  });
  return { fetchImpl, calls };
}

/** Build a normal Deepgram prerecorded success body with the given transcript. */
function deepgramTranscriptResponse(transcript: string): unknown {
  return {
    results: {
      channels: [
        {
          alternatives: [{ transcript, confidence: 0.99 }],
        },
      ],
    },
  };
}

const input: TranscribeInput = {
  audio: new Uint8Array([1, 2, 3, 4]),
  contentType: "audio/webm",
};

describe("DeepgramSpeechTranscriber — transcribe", () => {
  const OLD_KEY = process.env["DEEPGRAM_API_KEY"];
  const OLD_MODEL = process.env["DEEPGRAM_STT_MODEL"];
  const OLD_LANG = process.env["DEEPGRAM_STT_LANGUAGE"];

  beforeEach(() => {
    process.env["DEEPGRAM_API_KEY"] = "deepgram-test-key";
    delete process.env["DEEPGRAM_STT_MODEL"];
    delete process.env["DEEPGRAM_STT_LANGUAGE"];
  });

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env["DEEPGRAM_API_KEY"];
    else process.env["DEEPGRAM_API_KEY"] = OLD_KEY;
    if (OLD_MODEL === undefined) delete process.env["DEEPGRAM_STT_MODEL"];
    else process.env["DEEPGRAM_STT_MODEL"] = OLD_MODEL;
    if (OLD_LANG === undefined) delete process.env["DEEPGRAM_STT_LANGUAGE"];
    else process.env["DEEPGRAM_STT_LANGUAGE"] = OLD_LANG;
    vi.restoreAllMocks();
  });

  it("builds a /v1/listen request with default model/language/smart_format query params, Token auth, echoed Content-Type, and the RAW binary audio body", async () => {
    const { fetchImpl, calls } = makeFakeFetch(
      deepgramTranscriptResponse("build muscle four days a week"),
    );
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);

    const result = await adapter.transcribe(input);

    expect(result).toEqual({
      text: "build muscle four days a week",
      unclear: false,
    });
    expect(calls).toHaveLength(1);

    const { url, init } = calls[0]!;
    // Endpoint + query params (defaults nova-2 / es).
    expect(url).toContain("https://api.deepgram.com/v1/listen");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("model")).toBe("nova-2");
    expect(parsed.searchParams.get("language")).toBe("es");
    expect(parsed.searchParams.get("smart_format")).toBe("true");

    expect(init.method).toBe("POST");
    // Token auth scheme, Content-Type echoes the input mime.
    expect(init.headers["Authorization"]).toBe("Token deepgram-test-key");
    expect(init.headers["Content-Type"]).toBe("audio/webm");
    // Body is the RAW binary audio bytes — not JSON, not base64.
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(init.body)).toEqual(Array.from(input.audio));
  });

  it("echoes a different input.contentType (mp4) straight through as the Content-Type header", async () => {
    const { fetchImpl, calls } = makeFakeFetch(deepgramTranscriptResponse("hi"));
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);

    await adapter.transcribe({ ...input, contentType: "audio/mp4" });

    expect(calls[0]!.init.headers["Content-Type"]).toBe("audio/mp4");
  });

  it("uses DEEPGRAM_STT_MODEL and DEEPGRAM_STT_LANGUAGE when set", async () => {
    process.env["DEEPGRAM_STT_MODEL"] = "nova-3";
    process.env["DEEPGRAM_STT_LANGUAGE"] = "en";
    const { fetchImpl, calls } = makeFakeFetch(deepgramTranscriptResponse("ok"));
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);

    await adapter.transcribe(input);

    const parsed = new URL(calls[0]!.url);
    expect(parsed.searchParams.get("model")).toBe("nova-3");
    expect(parsed.searchParams.get("language")).toBe("en");
  });

  it("maps an empty transcript to {text:'', unclear:true}", async () => {
    const { fetchImpl } = makeFakeFetch(deepgramTranscriptResponse(""));
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("maps a whitespace-only transcript to {text:'', unclear:true}", async () => {
    const { fetchImpl } = makeFakeFetch(deepgramTranscriptResponse("   \n\t  "));
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("maps a response missing results/channels/alternatives to {text:'', unclear:true}", async () => {
    const { fetchImpl } = makeFakeFetch({ results: { channels: [] } });
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("trims surrounding whitespace on a real transcript", async () => {
    const { fetchImpl } = makeFakeFetch(deepgramTranscriptResponse("  hola mundo  "));
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);
    expect(await adapter.transcribe(input)).toEqual({
      text: "hola mundo",
      unclear: false,
    });
  });

  it("reads DEEPGRAM_API_KEY at call time, not at construction", async () => {
    delete process.env["DEEPGRAM_API_KEY"];
    const { fetchImpl, calls } = makeFakeFetch(deepgramTranscriptResponse("hello"));
    // Construction must not have read/observed the key at all.
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);
    expect(calls).toHaveLength(0);

    process.env["DEEPGRAM_API_KEY"] = "late-key";
    await adapter.transcribe(input);

    expect(calls[0]!.init.headers["Authorization"]).toBe("Token late-key");
  });

  it("a TERMINAL 429 (retries exhausted) throws ProviderRateLimitError('deepgram','stt'), not the generic error", async () => {
    const { fetchImpl } = makeFakeFetch({ error: "quota" }, { status: 429 });
    const adapter = new DeepgramSpeechTranscriber(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.transcribe(input);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ProviderRateLimitError);
    expect((caught as ProviderRateLimitError).provider).toBe("deepgram");
    expect((caught as ProviderRateLimitError).feature).toBe("stt");
    const serialized = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(serialized).not.toContain("deepgram-test-key");
  });

  it("throws a generic error with the status on a non-200, non-429 response WITHOUT leaking the key or audio", async () => {
    const { fetchImpl } = makeFakeFetch({ error: "bad request" }, { status: 400 });
    const adapter = new DeepgramSpeechTranscriber(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.transcribe(input);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ProviderRateLimitError);
    const err = caught as Error;
    expect(err.message).toContain("400");
    const serialized = `${err.message}\n${err.stack ?? ""}`;
    expect(serialized).not.toContain("deepgram-test-key");
    // The raw audio bytes must never appear in the error.
    expect(serialized).not.toContain(Buffer.from(input.audio).toString("base64"));
  });

  it("honors an already-aborted signal: throws WITHOUT calling fetch", async () => {
    const { fetchImpl, calls } = makeFakeFetch(deepgramTranscriptResponse("ignored"));
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.transcribe(input, controller.signal),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("forwards an AbortSignal into the fetch init", async () => {
    const { fetchImpl, calls } = makeFakeFetch(deepgramTranscriptResponse("ok"));
    const adapter = new DeepgramSpeechTranscriber(fetchImpl);
    const controller = new AbortController();

    await adapter.transcribe(input, controller.signal);

    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries a transient 503 and succeeds on the following 200 (zeroed backoff)", async () => {
    const { fetchImpl, calls } = makeSequencedFetch(
      [503, 200],
      deepgramTranscriptResponse("build muscle four days a week"),
    );
    const adapter = new DeepgramSpeechTranscriber(fetchImpl, [0, 0]);

    const result = await adapter.transcribe(input);

    expect(result).toEqual({
      text: "build muscle four days a week",
      unclear: false,
    });
    expect(calls).toHaveLength(2);
  });
});
