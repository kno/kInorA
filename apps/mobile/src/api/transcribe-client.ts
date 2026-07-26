/**
 * Direct mobile speech-to-text client (item-13 D1).
 *
 * Mobile uploads recorded audio DIRECTLY to `POST /plan-specs/transcribe` with
 * the Bearer token from Expo SecureStore — there is NO same-origin proxy (unlike
 * web, which needs one because the browser cannot attach the httpOnly session
 * cookie cross-origin). Mirrors `plan-draft-client.ts` for token/base/error
 * conventions.
 *
 * The audio is sent as a React Native multipart file part (`{ uri, name, type }`);
 * we deliberately do NOT set a `content-type` header so `fetch` computes the
 * multipart boundary itself. Raw audio never leaves this function beyond the
 * in-flight request body — nothing is persisted.
 *
 * The Pro gate, size/format caps, and the unclear-result taxonomy are enforced
 * SERVER-SIDE; this client only maps the response. NO `openai`/LLM import.
 */

/** The recording to upload (from `src/audio/recorder.ts`). */
export interface TranscribeAudio {
  uri: string;
  contentType: string;
  fileName: string;
}

/**
 * Transcription outcome:
 *   - `ok`    → `{ text, unclear }`; the caller starts a chat turn ONLY when
 *               `unclear` is false and `text` is non-empty.
 *   - `error` → `status` carries the HTTP status (`0` for a transport failure /
 *               offline); `sessionExpired` is set ONLY on a `401` or a missing
 *               token, the re-auth/logout signal the screen reacts to.
 */
export type TranscribeOutcome =
  | { kind: "ok"; text: string; unclear: boolean }
  | { kind: "error"; status: number; sessionExpired?: true };

/**
 * Narrow fetch shape (URL string + init), decoupled from the ambient
 * `typeof fetch` overloads — mirrors `plan-draft-client.ts`.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TranscribeOptions {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  /** Override the token source (defaults to SecureStore) — for tests. */
  getToken?: () => Promise<string | null>;
  /** Abort the in-flight upload (unmount/navigation). */
  signal?: AbortSignal;
}

/**
 * Default token source, lazy-imported so this module's graph does not pull in
 * `expo-secure-store` at import time (keeps it unit-testable). Mirrors
 * `plan-draft-client.ts` / `chat-stream.ts`.
 */
async function defaultGetToken(): Promise<string | null> {
  const { getSessionToken } = await import("../auth/session-storage");
  return getSessionToken();
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

export async function transcribeAudio(
  audio: TranscribeAudio,
  options: TranscribeOptions = {},
): Promise<TranscribeOutcome> {
  const token = await (options.getToken ?? defaultGetToken)();
  if (!token) return { kind: "error", status: 401, sessionExpired: true };

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);

  const form = new FormData();
  // React Native multipart file part. The DOM `FormData` typings expect a Blob,
  // but RN accepts a `{ uri, name, type }` descriptor at runtime — cast to keep
  // this file portable in both vitest (DOM FormData) and RN.
  form.append("audio", {
    uri: audio.uri,
    name: audio.fileName,
    type: audio.contentType,
  } as unknown as Blob);

  let res: Response;
  try {
    // Cast the init as a whole: RN's `RequestInit` body/signal types differ from
    // the DOM lib's, and we deliberately send a FormData body + optional signal.
    res = await fetchImpl(`${base}/plan-specs/transcribe`, {
      method: "POST",
      // Bearer only — NO content-type so fetch sets the multipart boundary.
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: options.signal,
    } as unknown as RequestInit);
  } catch {
    return { kind: "error", status: 0 };
  }

  if (res.status === 401) return { kind: "error", status: 401, sessionExpired: true };
  if (!res.ok) return { kind: "error", status: res.status };

  const data = (await res.json().catch(() => ({}))) as {
    text?: unknown;
    unclear?: unknown;
  };
  const text = typeof data.text === "string" ? data.text : "";
  const unclear = data.unclear === true || text.trim() === "";
  return { kind: "ok", text, unclear };
}
