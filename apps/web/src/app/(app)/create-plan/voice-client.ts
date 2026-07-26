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
 * response — e.g. a Free 403, an oversize 413, an unsupported-format 415, or
 * an upstream 502). Carries the status so the UI can react; B1 treats every
 * non-2xx as "voice input failed, try again" since the mic only appears in the
 * Pro flow (the 403 is the real server enforcement, not an expected path).
 */
export class TranscriptionError extends Error {
  constructor(readonly status: number) {
    super(`transcription_failed_${status}`);
    this.name = "TranscriptionError";
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

  if (!res.ok) throw new TranscriptionError(res.status);

  const data = (await res.json().catch(() => ({}))) as Partial<TranscriptionResult>;
  const text = typeof data.text === "string" ? data.text : "";
  const unclear = data.unclear === true || text.trim() === "";
  return { text, unclear };
}
