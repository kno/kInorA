import { afterEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

import { POST } from "../route";

function makeRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/create-plan/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cookieGet.mockReset();
  delete process.env.API_BASE_URL;
});

describe("POST /create-plan/chat — same-origin SSE proxy (12 Slice 3)", () => {
  it("401s with no_session when there is no kinora_session cookie, and never calls the upstream", async () => {
    cookieGet.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ message: "hi" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_session" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the session as a Bearer to the fixed API URL and streams the upstream SSE body back", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    process.env.API_BASE_URL = "http://api.test";
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: token\ndata: {}\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: upstreamBody,
      headers: new Headers({ "content-type": "text/event-stream" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ message: "hi" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { duplex?: string },
    ];
    expect(url).toBe("http://api.test/plan-specs/chat");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body as string)).toEqual({ message: "hi" });
    // undici requires `duplex` when a streamed body is present.
    expect(init.duplex).toBe("half");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.body).toBeTruthy();
  });

  it("passes through a non-2xx upstream status and body verbatim (e.g. Free's 403 premium_required)", async () => {
    cookieGet.mockReturnValue({ value: "tok-free" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      body: null,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({ error: "premium_required" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ message: "hi" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "premium_required" });
  });

  it("falls back to a generic chat_failed body when the upstream error response has no text", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      headers: new Headers(),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ message: "hi" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "chat_failed" });
  });

  it("maps an unreachable upstream to a generic api_unreachable error without leaking the internal API URL", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    process.env.API_BASE_URL = "http://api:4000";
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED http://api:4000"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ message: "hi" }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "api_unreachable" });
    expect(JSON.stringify(body)).not.toContain("api:4000");
  });

  it("forwards the client's AbortSignal to the upstream fetch so a browser abort cancels it", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream(),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const req = makeRequest({ message: "hi" }, controller.signal);
    await POST(req);

    // The Fetch API's `Request` constructor wraps the given signal into its
    // OWN internal AbortSignal that follows it — not the same object
    // reference — so assert the route forwards `request.signal` itself
    // (the exact signal seen by the handler), not a freshly created one.
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(req.signal);
  });
});
