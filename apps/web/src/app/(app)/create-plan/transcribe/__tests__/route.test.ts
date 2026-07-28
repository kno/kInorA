import { afterEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

import { POST } from "../route";

const BOUNDARY = "----kinoratest";

function makeRequest(signal?: AbortSignal): Request {
  return new Request("http://localhost/create-plan/transcribe", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    body: "fake-multipart-audio-bytes",
    signal,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cookieGet.mockReset();
  delete process.env.API_BASE_URL;
});

describe("POST /create-plan/transcribe — same-origin multipart proxy (13 B1)", () => {
  it("401s with no_session when there is no kinora_session cookie, and never calls the upstream", async () => {
    cookieGet.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_session" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the session as a Bearer + the BUFFERED multipart body (no streaming/duplex) to the API transcribe route", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    process.env.API_BASE_URL = "http://api.test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: "hello", unclear: false }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { duplex?: string },
    ];
    expect(url).toBe("http://api.test/plan-specs/transcribe");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    // The multipart content-type (with its boundary) is preserved.
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      `multipart/form-data; boundary=${BOUNDARY}`,
    );
    // The body is forwarded fully buffered (an ArrayBuffer), never a stream —
    // no `duplex` option should be present.
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect(init.duplex).toBeUndefined();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "hello", unclear: false });
  });

  it("passes through a Free 403 premium_required verbatim so the gate denial surfaces", async () => {
    cookieGet.mockReturnValue({ value: "tok-free" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: "premium_required" }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "premium_required" });
  });

  it("passes through a 413 (too large) verbatim", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      text: async () => JSON.stringify({ error: "audio_too_large" }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "audio_too_large" });
  });

  it("passes through a 415 (unsupported format) verbatim", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 415,
      text: async () => JSON.stringify({ error: "unsupported_audio_format" }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_audio_format" });
  });

  it("falls back to a generic transcription_failed body when the upstream error response has no text", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "",
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "transcription_failed" });
  });

  it("maps an unreachable upstream to a generic api_unreachable error without leaking the internal API URL, and logs the failure server-side", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    process.env.API_BASE_URL = "http://api:4000";
    const upstreamError = new Error("ECONNREFUSED http://api:4000");
    const fetchMock = vi.fn().mockRejectedValue(upstreamError);
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "api_unreachable" });
    expect(JSON.stringify(body)).not.toContain("api:4000");
    expect(errorSpy).toHaveBeenCalledWith(
      "[transcribe-proxy] upstream fetch failed",
      upstreamError,
    );
  });

  it("does NOT forward the client's AbortSignal to the upstream fetch (buffered upload consumes the request → its signal fires immediately under Next/undici, which would spuriously abort the upstream call)", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: "ok", unclear: false }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const req = makeRequest(controller.signal);
    await POST(req);

    // The proxy runs the short, stateless transcription to completion even if
    // the browser later disconnects; no signal is threaded to the upstream call.
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeUndefined();
  });
});
