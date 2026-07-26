/**
 * Direct mobile text-to-speech client (item-13 D2).
 *
 * Mobile requests TTS audio DIRECTLY from `POST /plan-specs/speech` with the
 * Bearer token from Expo SecureStore — there is NO same-origin proxy (unlike
 * web, which needs one because the browser cannot attach the httpOnly session
 * cookie cross-origin). Mirrors `transcribe-client.ts` for token/base/error
 * conventions.
 *
 * The Pro gate and the TTS opt-out preference are enforced SERVER-SIDE; this
 * client only maps the response taxonomy:
 *   - `200 audio/mpeg` → `{ kind: "ok", audio: { bytes, contentType } }`
 *   - `204 No Content` → `{ kind: "opt_out" }` (TTS disabled — skip playback)
 *   - empty `200` body → `{ kind: "opt_out" }` (nothing to play)
 *   - `401`/no token  → `{ kind: "error", status: 401, sessionExpired: true }`
 *   - `403`/`502`/... → `{ kind: "error", status }`
 *   - network throw   → `{ kind: "error", status: 0 }` (offline)
 *
 * TTS is a best-effort enhancement over the already-shown text reply, so the
 * caller fails silently on every non-`ok` outcome. Audio bytes never leave this
 * function beyond the returned buffer — nothing is persisted. NO `openai`/LLM
 * import (deps-guard clean).
 */

/** The synthesized reply audio ready to hand to `audio/player.ts`. */
export interface SpeechAudio {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Synthesis outcome — a discriminated union mirroring the transcribe client:
 *   - `ok`      → playable audio.
 *   - `opt_out` → the user disabled TTS (204) or the server returned no audio;
 *                 the caller skips playback with no error.
 *   - `error`   → `status` carries the HTTP status (`0` for a transport failure /
 *                 offline); `sessionExpired` is set ONLY on a `401` or a missing
 *                 token. Every error is handled silently by the voice screen.
 */
export type SpeechOutcome =
  | { kind: "ok"; audio: SpeechAudio }
  | { kind: "opt_out" }
  | { kind: "error"; status: number; sessionExpired?: true };

/** Narrow fetch shape (URL string + init) — mirrors `transcribe-client.ts`. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SpeechOptions {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  /** Override the token source (defaults to SecureStore) — for tests. */
  getToken?: () => Promise<string | null>;
  /** Abort the in-flight request (new turn / unmount / end-session). */
  signal?: AbortSignal;
}

/**
 * Default token source, lazy-imported so this module's graph does not pull in
 * `expo-secure-store` at import time (keeps it unit-testable). Mirrors
 * `transcribe-client.ts`.
 */
async function defaultGetToken(): Promise<string | null> {
  const { getSessionToken } = await import("../auth/session-storage");
  return getSessionToken();
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

export async function synthesizeSpeech(
  text: string,
  options: SpeechOptions = {},
): Promise<SpeechOutcome> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", status: 401, sessionExpired: true };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);

  let res: Response;
  try {
    res = await fetchImpl(`${base}/plan-specs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text }),
      signal: options.signal,
    } as unknown as RequestInit);
  } catch {
    return { kind: "error", status: 0 };
  }

  // TTS opted out upstream → skip playback quietly (checked before ok/audio;
  // 204 is within the 2xx range).
  if (res.status === 204) return { kind: "opt_out" };
  if (res.status === 401) return { kind: "error", status: 401, sessionExpired: true };
  if (!res.ok) return { kind: "error", status: res.status };

  const buffer = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
  const bytes = new Uint8Array(buffer);
  // An empty body carries nothing to play — treat it like an opt-out.
  if (bytes.length === 0) return { kind: "opt_out" };

  const contentType = res.headers.get("content-type") ?? "audio/mpeg";
  return { kind: "ok", audio: { bytes, contentType } };
}
