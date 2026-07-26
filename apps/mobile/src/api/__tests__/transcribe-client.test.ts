import { describe, expect, it, vi } from "vitest";
import { transcribeAudio, type TranscribeAudio } from "../transcribe-client";

const AUDIO: TranscribeAudio = {
  uri: "file:///tmp/recording.m4a",
  contentType: "audio/m4a",
  fileName: "audio.m4a",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("transcribeAudio (D1 direct mobile → /plan-specs/transcribe)", () => {
  it("posts the m4a as multipart with a Bearer token and maps a 200 result", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { text: "quiero fuerza", unclear: false }),
    );

    const outcome = await transcribeAudio(AUDIO, {
      fetchImpl,
      apiBaseUrl: "https://api.test",
      getToken: async () => "tok_123",
    });

    expect(outcome).toEqual({ kind: "ok", text: "quiero fuerza", unclear: false });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.test/plan-specs/transcribe");
    expect(init?.method).toBe("POST");
    // Bearer attached directly (no same-origin proxy, unlike web).
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok_123");
    // No explicit content-type — fetch sets the multipart boundary itself.
    expect((init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("treats an empty transcript as unclear (caller must not start a chat turn)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { text: "", unclear: true }));
    const outcome = await transcribeAudio(AUDIO, {
      fetchImpl,
      getToken: async () => "tok",
    });
    expect(outcome).toEqual({ kind: "ok", text: "", unclear: true });
  });

  it("maps a 401 to a session-expiry error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: "unauthorized" }));
    const outcome = await transcribeAudio(AUDIO, {
      fetchImpl,
      getToken: async () => "tok",
    });
    expect(outcome).toEqual({ kind: "error", status: 401, sessionExpired: true });
  });

  it("surfaces the Pro gate (403) and other non-2xx by status without a session signal", async () => {
    for (const status of [403, 413, 415, 502]) {
      const fetchImpl = vi.fn(async () => jsonResponse(status, { error: "x" }));
      const outcome = await transcribeAudio(AUDIO, {
        fetchImpl,
        getToken: async () => "tok",
      });
      expect(outcome).toEqual({ kind: "error", status });
    }
  });

  it("returns a session-expiry error when no token is stored (no fetch)", async () => {
    const fetchImpl = vi.fn();
    const outcome = await transcribeAudio(AUDIO, {
      fetchImpl,
      getToken: async () => null,
    });
    expect(outcome).toEqual({ kind: "error", status: 401, sessionExpired: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a network throw to a status-0 error (offline)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const outcome = await transcribeAudio(AUDIO, {
      fetchImpl,
      getToken: async () => "tok",
    });
    expect(outcome).toEqual({ kind: "error", status: 0 });
  });
});
