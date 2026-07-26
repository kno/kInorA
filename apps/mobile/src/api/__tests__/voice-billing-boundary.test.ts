import { describe, expect, it, vi } from "vitest";
import { transcribeAudio, type TranscribeAudio } from "../transcribe-client";
import { synthesizeSpeech } from "../speech-client";
import { confirmPlan } from "../plan-draft-client";

/**
 * Voice billing-boundary (item-13 spec: "Voice Billing Boundary").
 *
 * A voice turn — transcribe → chat → speak — must consume ZERO billing units.
 * The ONLY `plan_generation`-consuming call is the unchanged confirm→generate
 * gate (`POST /plan-specs/:id/confirm`), reached from the create-plan confirm
 * flow, never from the voice loop. This test pins the boundary at the client
 * level: the voice clients only ever call their own non-metered endpoints, and
 * `confirmPlan` is the single call that hits the generation endpoint.
 *
 * (The chat stream reads `POST /plan-specs/chat` over XHR — also non-metered —
 * and is covered byte-for-byte in `chat-stream.test.ts`.)
 */

/** Any URL that triggers server-side plan generation (a billing unit). */
const GENERATION_ENDPOINT = /\/plan-specs\/[^/]+\/confirm$/;

const AUDIO: TranscribeAudio = {
  uri: "file:///tmp/recording.m4a",
  contentType: "audio/m4a",
  fileName: "audio.m4a",
};

describe("voice billing boundary", () => {
  it("transcribe + speech never target a plan-generation endpoint", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith("/transcribe")) {
        return new Response(JSON.stringify({ text: "arma mi plan", unclear: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // /speech → mp3 bytes
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });

    await transcribeAudio(AUDIO, { fetchImpl, apiBaseUrl: "https://api.test", getToken: async () => "tok" });
    await synthesizeSpeech("hola", { fetchImpl, apiBaseUrl: "https://api.test", getToken: async () => "tok" });

    expect(urls).toEqual([
      "https://api.test/plan-specs/transcribe",
      "https://api.test/plan-specs/speech",
    ]);
    // ZERO generation units consumed across the entire voice path.
    expect(urls.some((u) => GENERATION_ENDPOINT.test(u))).toBe(false);
  });

  it("only confirm→generate consumes a plan_generation unit", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ planId: "plan_1", status: "generating" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await confirmPlan("spec_1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiBaseUrl: "https://api.test",
      getToken: async () => "tok",
    });

    expect(result).toEqual({ kind: "ok", planId: "plan_1", status: "generating" });
    // Exactly one generation-consuming call — the confirm gate.
    expect(urls.filter((u) => GENERATION_ENDPOINT.test(u))).toEqual([
      "https://api.test/plan-specs/spec_1/confirm",
    ]);
  });
});
