import { describe, expect, it, vi } from "vitest";
import {
  SPEECH_ENDPOINT,
  TRANSCRIBE_ENDPOINT,
  TranscriptionError,
  selectMimeType,
  synthesizeSpeech,
  transcribeAudio,
} from "../voice-client";

describe("voice-client — selectMimeType", () => {
  it("prefers audio/webm;codecs=opus when supported", () => {
    const isSupported = vi.fn((type: string) => type === "audio/webm;codecs=opus");
    expect(selectMimeType(isSupported)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to audio/mp4 for Safari (no webm support)", () => {
    const isSupported = vi.fn((type: string) => type === "audio/mp4");
    expect(selectMimeType(isSupported)).toBe("audio/mp4");
  });

  it("falls back to plain audio/webm when opus is unavailable but webm is", () => {
    const isSupported = vi.fn((type: string) => type === "audio/webm");
    expect(selectMimeType(isSupported)).toBe("audio/webm");
  });

  it("returns undefined (browser default) when nothing in the preference list is supported", () => {
    expect(selectMimeType(() => false)).toBeUndefined();
  });
});

describe("voice-client — transcribeAudio", () => {
  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  it("throws a TranscriptionError carrying the parsed reason on a 429 rate-limit response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: "rate_limited" }, false, 429),
    );
    await expect(
      transcribeAudio(new Blob(["x"], { type: "audio/webm" }), { fetchImpl }),
    ).rejects.toMatchObject({ name: "TranscriptionError", status: 429, reason: "rate_limited" });
  });

  it("falls back to the transcription_failed reason when the error body has no parseable error field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({}, false, 502),
    );
    await expect(
      transcribeAudio(new Blob(["x"], { type: "audio/webm" }), { fetchImpl }),
    ).rejects.toMatchObject({ name: "TranscriptionError", status: 502, reason: "transcription_failed" });
  });

  it("POSTs the blob as multipart form-data to the transcribe proxy and returns the transcript", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ text: "build muscle four days a week", unclear: false }),
    );
    const blob = new Blob(["fake-audio"], { type: "audio/webm" });

    const result = await transcribeAudio(blob, { fetchImpl });

    expect(result).toEqual({ text: "build muscle four days a week", unclear: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TRANSCRIBE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("audio")).toBeInstanceOf(Blob);
  });

  it("forwards the caller's AbortSignal so a canceled capture cancels the upload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ text: "hi", unclear: false }));
    const controller = new AbortController();
    await transcribeAudio(new Blob(["x"], { type: "audio/webm" }), {
      fetchImpl,
      signal: controller.signal,
    });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it("treats an empty transcript as unclear even when the server reports unclear:false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ text: "   ", unclear: false }));
    const result = await transcribeAudio(new Blob(["x"], { type: "audio/webm" }), { fetchImpl });
    expect(result).toEqual({ text: "   ", unclear: true });
  });

  it("propagates an explicit unclear:true result (silence/noise)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ text: "", unclear: true }));
    const result = await transcribeAudio(new Blob(["x"], { type: "audio/webm" }), { fetchImpl });
    expect(result).toEqual({ text: "", unclear: true });
  });

  it("throws a TranscriptionError carrying the status on a non-2xx proxy response (e.g. Free 403)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "premium_required" }, false, 403));
    await expect(
      transcribeAudio(new Blob(["x"], { type: "audio/webm" }), { fetchImpl }),
    ).rejects.toMatchObject({ name: "TranscriptionError", status: 403 });
  });

  it("throws a TranscriptionError with status 413 when the upload is too large", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "too_large" }, false, 413));
    await expect(
      transcribeAudio(new Blob(["x"], { type: "audio/webm" }), { fetchImpl }),
    ).rejects.toBeInstanceOf(TranscriptionError);
  });
});

describe("voice-client — synthesizeSpeech", () => {
  function audioResponse(bytes: number[], status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      blob: async () => new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }),
    } as unknown as Response;
  }

  it("POSTs the reply text as JSON to the speech proxy and resolves the audio blob", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse([1, 2, 3]));

    const blob = await synthesizeSpeech("four days a week it is", { fetchImpl });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SPEECH_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ text: "four days a week it is" }));
  });

  it("forwards the caller's AbortSignal so aborting the turn cancels the audio fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse([1]));
    const controller = new AbortController();
    await synthesizeSpeech("hi", { fetchImpl, signal: controller.signal });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it("resolves null on a 204 (TTS opted out) so the caller skips playback silently", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
    const blob = await synthesizeSpeech("hi", { fetchImpl });
    expect(blob).toBeNull();
  });

  it("resolves null on a non-2xx (403/502) so a TTS failure never breaks the shown chat reply", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse([], 502));
    const blob = await synthesizeSpeech("hi", { fetchImpl });
    expect(blob).toBeNull();
  });

  it("resolves null when the audio body is empty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse([]));
    const blob = await synthesizeSpeech("hi", { fetchImpl });
    expect(blob).toBeNull();
  });
});
