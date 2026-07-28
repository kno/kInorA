import type { PlanSpecDraft } from "@kinora/contracts";

/**
 * Pure web-voice capture helpers (13 Slice B1).
 *
 * The browser ONLY records audio and ships the bytes to the same-origin
 * transcribe proxy — it never imports `openai`/any LLM lib (deps-guard: no
 * AI packages in web). Format selection and the transcribe call are isolated
 * here as pure, unit-testable functions; the React glue (permission prompt,
 * listening/processing states, feeding `runTurn`) lives in `AssistantPane`.
 */

// Referenced so the transcript type stays pinned to the shared contract even
// though B1 only forwards `{ text }` into the existing chat turn.
export type VoiceTranscript = Pick<PlanSpecDraft, never> & { text: string };

/** Same-origin proxy that injects the Bearer and forwards the multipart audio. */
export const TRANSCRIBE_ENDPOINT = "/create-plan/transcribe";

/** Same-origin proxy that injects the Bearer and returns the reply's mp3 audio (B2). */
export const SPEECH_ENDPOINT = "/create-plan/speech";

/**
 * Preferred MediaRecorder container formats, in order: Chrome/Firefox opus
 * first, then a plain-webm fallback, then `audio/mp4` for Safari (which does
 * not support webm). Returning `undefined` lets the browser pick its default
 * when none of these are supported.
 */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export interface TranscriptionResult {
  /** The transcript; `""` when the recording was unintelligible. */
  text: string;
  /** True on silence/noise/empty — the caller MUST NOT start a chat turn. */
  unclear: boolean;
}

/**
 * A transcribe request that failed at the transport level (a non-2xx proxy
 * response — e.g. a Free 403, an oversize 413, an unsupported-format 415, a
 * 429 rate-limit, or an upstream 502). Carries the status AND the proxy's
 * `{ error }` reason string (`premium_required`, `rate_limited`,
 * `transcription_failed`, `api_unreachable`, ...) so the UI can distinguish a
 * rate-limit from a transport failure instead of surfacing every non-2xx as
 * the same generic "voice input failed, try again".
 */
export class TranscriptionError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string = "transcription_failed",
  ) {
    super(`transcription_failed_${status}`);
    this.name = "TranscriptionError";
  }
}

/** Best-effort parse of the proxy's `{ error }` JSON body into a reason string. */
async function readErrorReason(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as Partial<{ error: string }>;
    return typeof data.error === "string" && data.error !== "" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

function isTypeSupportedDefault(type: string): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(type)
  );
}

/**
 * Pick the first supported recording mimeType (webm/opus → webm → mp4 Safari),
 * or `undefined` to defer to the browser default. `isTypeSupported` is injected
 * for tests; it defaults to `MediaRecorder.isTypeSupported`.
 */
export function selectMimeType(
  isTypeSupported: (type: string) => boolean = isTypeSupportedDefault,
): string | undefined {
  for (const type of PREFERRED_MIME_TYPES) {
    if (isTypeSupported(type)) return type;
  }
  return undefined;
}

/** A short filename with an extension hint OpenAI's Whisper uses to route the decoder. */
function filenameForType(type: string): string {
  if (type.includes("mp4") || type.includes("m4a")) return "audio.mp4";
  if (type.includes("mpeg")) return "audio.mp3";
  if (type.includes("wav")) return "audio.wav";
  return "audio.webm";
}

/**
 * POST a recorded audio blob to the same-origin transcribe proxy and resolve
 * `{ text, unclear }`. A non-2xx response rejects with a `TranscriptionError`;
 * an empty/whitespace transcript (or an explicit `unclear:true`) resolves as
 * `unclear` so the caller re-prompts instead of starting a chat turn.
 */
export async function transcribeAudio(
  blob: Blob,
  options: { signal?: AbortSignal; endpoint?: string; fetchImpl?: typeof fetch } = {},
): Promise<TranscriptionResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const form = new FormData();
  form.append("audio", blob, filenameForType(blob.type));

  const res = await doFetch(options.endpoint ?? TRANSCRIBE_ENDPOINT, {
    method: "POST",
    body: form,
    signal: options.signal,
  });

  if (!res.ok) {
    const reason = await readErrorReason(res, "transcription_failed");
    throw new TranscriptionError(res.status, reason);
  }

  const data = (await res.json().catch(() => ({}))) as Partial<TranscriptionResult>;
  const text = typeof data.text === "string" ? data.text : "";
  const unclear = data.unclear === true || text.trim() === "";
  return { text, unclear };
}

/**
 * POST the terminal assistant reply text to the same-origin speech proxy and
 * resolve the mp3 audio `Blob` for after-turn playback (13 Slice B2).
 *
 * TTS is a best-effort enhancement over the already-shown text reply, so this
 * never throws for an expected outcome: a `204` (the user opted out upstream)
 * and any non-2xx (a Free `403`, a `502` synthesis failure) both resolve to
 * `null` so the caller simply skips playback with no error surfaced in the
 * chat. An empty body also resolves `null`. A genuine transport rejection
 * (network down, an `AbortError` from a canceled turn) still rejects so the
 * caller can distinguish an abort — it treats every rejection as "no playback"
 * regardless. Raw audio never leaves this function beyond the in-flight fetch.
 */
export async function synthesizeSpeech(
  text: string,
  options: { signal?: AbortSignal; endpoint?: string; fetchImpl?: typeof fetch } = {},
): Promise<Blob | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(options.endpoint ?? SPEECH_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: options.signal,
  });

  // 204 (opted out) or any non-2xx (403/502/429) → no audio to play. Capture
  // the reason for console visibility only — TTS stays fail-silent to the
  // caller either way (no reason is thrown/returned here).
  if (res.status === 204) return null;
  if (!res.ok) {
    const reason = await readErrorReason(res, "speech_failed");
    console.warn("[voice] tts request failed", { reason, status: res.status });
    return null;
  }

  const blob = await res.blob();
  return blob.size > 0 ? blob : null;
}
