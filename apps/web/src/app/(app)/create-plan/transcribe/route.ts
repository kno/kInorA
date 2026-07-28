import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";

/**
 * Same-origin multipart proxy for web voice transcription (13 Slice B1).
 *
 * Mirrors the chat proxy (`../chat/route.ts`): the browser cannot attach the
 * `kinora_session` httpOnly cookie as a Bearer to the cross-origin API, so the
 * MediaRecorder blob is POSTed to THIS route (same-origin), which reads the
 * session cookie server-side and forwards the multipart body to
 * `POST {API_BASE_URL}/plan-specs/transcribe` as a Bearer. The upload is
 * buffered (`request.arrayBuffer()`) before the upstream fetch rather than
 * streamed — create-plan clips are small (<=15MB), and streaming
 * `request.body` straight through with `duplex: "half"` proved flaky under
 * Next dev/undici when the body originates from a browser upload (it works
 * fine via curl with a complete body, but intermittently 502s with no
 * api-side log against a real browser MediaRecorder upload). The upstream
 * `{ text, unclear }` JSON and its status are passed through verbatim — a
 * Free user's 403, an oversize 413, an unsupported-format 415, and a
 * transport 502 all surface unchanged so the client can react. No token
 * ever reaches the browser; no LLM import here.
 */
export const dynamic = "force-dynamic";

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return jsonError("no_session", 401);

  // Preserve the multipart boundary from the incoming request's content-type.
  const contentType = request.headers.get("content-type") ?? "application/octet-stream";

  // Buffer the upload fully before forwarding — see the module doc for why
  // streaming `request.body` with `duplex: "half"` is flaky here.
  const body = await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/plan-specs/transcribe`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        authorization: `Bearer ${token}`,
      },
      body,
      // NOTE: do NOT forward `request.signal` here. Once the upload is fully
      // buffered above (`request.arrayBuffer()`), the incoming request is
      // "consumed" and Next dev/undici fires `request.signal` immediately —
      // which would abort this upstream call (observed: api AbortError ~40ms →
      // 502 transcription_failed on the FIRST transcribe). The transcription is
      // short and stateless, so running it to completion even if the client
      // later disconnects is harmless.
      cache: "no-store",
    });
  } catch (err) {
    // Never leak the internal API URL — a generic unreachable error only —
    // but DO log server-side so a flaky/failed upstream fetch is visible.
    console.error("[transcribe-proxy] upstream fetch failed", err);
    return jsonError("api_unreachable", 502);
  }

  // Pass the upstream status + body through faithfully (200 { text, unclear },
  // 403/413/415/400/502). The audio is transcribed in-flight upstream and
  // never persisted; this proxy holds no state.
  const text = await upstream.text().catch(() => "");
  return new Response(text || JSON.stringify({ error: "transcription_failed" }), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
