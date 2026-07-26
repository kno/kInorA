import { describe, expect, it, vi } from "vitest";
import { synthesizeSpeech } from "../speech-client";

function audioResponse(status: number, bytes: Uint8Array): Response {
  return new Response(bytes, {
    status,
    headers: { "content-type": "audio/mpeg" },
  });
}

const MP3 = new Uint8Array([0xff, 0xf3, 0x64, 0x00]);

describe("synthesizeSpeech (D2 direct mobile → /plan-specs/speech)", () => {
  it("posts the text as JSON with a Bearer token and maps a 200 mp3 body", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => audioResponse(200, MP3));

    const outcome = await synthesizeSpeech("hola atleta", {
      fetchImpl,
      apiBaseUrl: "https://api.test",
      getToken: async () => "tok_123",
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.audio.contentType).toBe("audio/mpeg");
      expect(Array.from(outcome.audio.bytes)).toEqual(Array.from(MP3));
    }

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.test/plan-specs/speech");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok_123");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ text: "hola atleta" }));
  });

  it("maps a 204 (TTS opted out) to opt_out with no body read and no playable audio", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const outcome = await synthesizeSpeech("x", { fetchImpl, getToken: async () => "tok" });
    expect(outcome).toEqual({ kind: "opt_out" });
  });

  it("treats an empty 200 body as nothing to play (opt_out)", async () => {
    const fetchImpl = vi.fn(async () => audioResponse(200, new Uint8Array()));
    const outcome = await synthesizeSpeech("x", { fetchImpl, getToken: async () => "tok" });
    expect(outcome).toEqual({ kind: "opt_out" });
  });

  it("maps a 401 to a session-expiry error", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    const outcome = await synthesizeSpeech("x", { fetchImpl, getToken: async () => "tok" });
    expect(outcome).toEqual({ kind: "error", status: 401, sessionExpired: true });
  });

  it("maps the Pro gate (403) and synthesis failure (502) to a status error", async () => {
    for (const status of [403, 502]) {
      const fetchImpl = vi.fn(async () => new Response("{}", { status }));
      const outcome = await synthesizeSpeech("x", { fetchImpl, getToken: async () => "tok" });
      expect(outcome).toEqual({ kind: "error", status });
    }
  });

  it("returns a session-expiry error when no token is stored (no fetch)", async () => {
    const fetchImpl = vi.fn();
    const outcome = await synthesizeSpeech("x", { fetchImpl, getToken: async () => null });
    expect(outcome).toEqual({ kind: "error", status: 401, sessionExpired: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a network throw to a status-0 error (offline, fail silently upstream)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const outcome = await synthesizeSpeech("x", { fetchImpl, getToken: async () => "tok" });
    expect(outcome).toEqual({ kind: "error", status: 0 });
  });
});
