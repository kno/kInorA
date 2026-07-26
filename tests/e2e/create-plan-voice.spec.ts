import { expect, test } from "@playwright/test";
import { registerTenant, useSession } from "./helpers/billing-seed";

/**
 * Create-plan voice capture flow e2e (issue #229).
 *
 * The 13-interactive-voice-chat Slice B1 mic affordance (capture → transcribe →
 * feed the existing chat turn) and its graceful-degradation paths (permission
 * denied → keep typing; a failed transcription → gentle notice) were proven
 * only in component tests with a faked MediaRecorder, never as a live session
 * against the real Next.js app + Fastify api booted by `scripts/e2e-with-stack.mjs`.
 * This spec closes that gap for the deterministic surface.
 *
 * IMPORTANT — the e2e stack has NO LLM/STT key (CI logs: "OPENROUTER_API_KEY is
 * not set …"), so a LIVE transcribe turn cannot yield a real transcript. This
 * spec therefore asserts only model-INDEPENDENT behavior and MOCKS the browser
 * mic/audio at the page boundary (`addInitScript` stubbing
 * `navigator.mediaDevices` + `MediaRecorder`) — no real device or permission
 * prompt is ever involved:
 *   - the mic affordance is present + enabled for a Pro tenant,
 *   - a mic-permission denial degrades to a "keep typing" notice (text stays
 *     usable), and
 *   - a capture whose transcription cannot complete (STT unconfigured) surfaces
 *     a graceful voice notice and never starts a chat turn or crashes.
 *
 * A live keyed transcribe→chat→TTS turn is deferred to a keyed environment —
 * see the KEYED-ENV FOLLOW-UP note at the bottom of this file.
 *
 * Requires the api + migrated Postgres booted by `scripts/e2e-with-stack.mjs`.
 */

const MIC_START = "Start voice input";
const MIC_STOP = "Stop recording";
const CHAT_INPUT = "Chat message";

test.describe("Create-plan voice capture (#229)", () => {
  test("a Pro tenant sees the mic affordance enabled alongside the text input", async ({
    page,
  }) => {
    // A fresh registration is Pro/trialing → the Asistente (voice-capable) pane.
    const tenant = await registerTenant(page);
    await useSession(page, tenant.token);
    await page.goto("/create-plan");

    // The mic button is present and enabled (feature-detected: Chromium has both
    // getUserMedia and MediaRecorder), and the text input is available too.
    const mic = page.getByRole("button", { name: MIC_START });
    await expect(mic).toBeVisible();
    await expect(mic).toBeEnabled();
    await expect(page.getByRole("textbox", { name: CHAT_INPUT })).toBeEnabled();
  });

  test("a mic-permission denial degrades gracefully: a keep-typing notice and a still-usable text input", async ({
    page,
  }) => {
    const tenant = await registerTenant(page);
    await useSession(page, tenant.token);

    // Force a permission denial at the mic boundary — no real device or prompt.
    // MediaRecorder stays native so feature-detection still enables the mic.
    await page.addInitScript(() => {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("denied", "NotAllowedError"));
      }
    });

    await page.goto("/create-plan");

    const mic = page.getByRole("button", { name: MIC_START });
    await expect(mic).toBeEnabled();
    await mic.click();

    // The gentle "keep typing" notice appears and the text input stays usable.
    await expect(
      page.getByText("Microphone access is required for voice. You can keep typing."),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: CHAT_INPUT })).toBeEnabled();
    // The mic is NOT permanently disabled — a later grant can recover in-session.
    await expect(mic).toBeEnabled();
  });

  test("a capture whose transcription cannot complete (STT unconfigured) surfaces a graceful notice, not a crash", async ({
    page,
  }) => {
    const tenant = await registerTenant(page);
    await useSession(page, tenant.token);

    // Stub the mic/recorder at the page boundary so a capture completes and the
    // component POSTs the blob to the REAL same-origin transcribe proxy. With no
    // STT key the upstream fails (non-2xx), which the client surfaces as a gentle
    // voice notice — never a started chat turn, never a crash. No real audio.
    await page.addInitScript(() => {
      const fakeStream = {
        getTracks: () => [{ stop() {} }],
      } as unknown as MediaStream;
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {},
        });
      }
      navigator.mediaDevices.getUserMedia = () => Promise.resolve(fakeStream);

      class FakeMediaRecorder {
        static isTypeSupported() {
          return true;
        }
        state: "inactive" | "recording" = "inactive";
        mimeType = "audio/webm";
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: this.mimeType }) });
          this.onstop?.();
        }
      }
      (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
    });

    await page.goto("/create-plan");

    const mic = page.getByRole("button", { name: MIC_START });
    await expect(mic).toBeEnabled();

    // Start recording → the control offers "Stop recording".
    await mic.click();
    const stop = page.getByRole("button", { name: MIC_STOP });
    await expect(stop).toBeVisible();

    // Stop → the blob is transcribed against the real (unconfigured) proxy.
    await stop.click();

    // Without a model the transcription cannot succeed. The result is ALWAYS one
    // of the two graceful, model-independent voice notices — a transport failure
    // ("Voice input failed…") or an empty/unclear transcript ("I didn't catch
    // that…") — never a started chat turn. Accept either graceful outcome.
    await expect(
      page.getByText(
        /Voice input failed\. Please try again\.|I didn't catch that\. Please try again\./,
      ),
    ).toBeVisible({ timeout: 30_000 });

    // No user chat bubble was appended (no chat turn started from a failed
    // capture) and the text input stays usable.
    await expect(page.getByText("audio-bytes")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: CHAT_INPUT })).toBeEnabled();
  });
});

/**
 * KEYED-ENV FOLLOW-UP (do NOT fake a pass here) — a full live voice turn needs
 * an STT/LLM key the e2e stack deliberately does not carry:
 *
 *   [ ] With STT + a model configured, record a clear utterance and assert the
 *       transcript is fed into the chat turn as a user message, the assistant
 *       replies, and (B2) the reply is spoken back via the speech proxy.
 *   [ ] A silence/noise capture re-prompts ("I didn't catch that") WITHOUT
 *       starting a chat turn (already covered structurally by the component
 *       tests; a live keyed run confirms the STT boundary end-to-end).
 */
