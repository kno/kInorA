import { afterEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

import { POST } from "../route";

function makeRequest(signal?: AbortSignal): Request {
  return new Request("http://localhost/create-plan/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Great, four days a week it is." }),
    signal,
  });
}

/** A minimal ReadableStream carrying the given bytes (mp3 audio surrogate). */
function audioStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cookieGet.mockReset();
  delete process.env.API_BASE_URL;
});

describe("POST /create-plan/speech — same-origin TTS proxy (13 B2)", () => {
  it("401s with no_session when there is no kinora_session cookie, and never calls the upstream", async () => {
    cookieGet.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_session" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the session as a Bearer + the JSON text body to the API speech route, keeping the token server-side", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    process.env.API_BASE_URL = "http://api.test";
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: audioStream(bytes),
      headers: new Headers({ "content-type": "audio/mpeg" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/plan-specs/speech");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ text: "Great, four days a week it is." }));

    // The 200 audio body + content-type pass through so the client can play it.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    const out = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    // The Bearer never reaches the client response headers.
    expect(res.headers.get("authorization")).toBeNull();
  });

  it("passes a 204 (TTS opted out) through as a bodyless 204 so the client skips playback silently", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      body: null,
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("passes a Free 403 premium_required through verbatim", async () => {
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

  it("passes an upstream 502 synthesis_failed through verbatim", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: "synthesis_failed" }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "synthesis_failed" });
  });

  it("falls back to a generic synthesis_failed body when the upstream error response has no text", async () => {
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
    expect(await res.json()).toEqual({ error: "synthesis_failed" });
  });

  it("maps an unreachable upstream to a generic api_unreachable error without leaking the internal API URL", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    process.env.API_BASE_URL = "http://api:4000";
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED http://api:4000"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "api_unreachable" });
    expect(JSON.stringify(body)).not.toContain("api:4000");
  });

  it("forwards the client's AbortSignal to the upstream fetch so a browser abort cancels it", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      body: null,
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const req = makeRequest(controller.signal);
    await POST(req);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(req.signal);
  });
});
