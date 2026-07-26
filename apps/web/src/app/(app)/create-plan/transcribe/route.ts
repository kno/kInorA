import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";

/**
 * Same-origin multipart proxy for web voice transcription (13 Slice B1).
 *
 * Mirrors the chat proxy (`../chat/route.ts`): the browser cannot attach the
 * `kinora_session` httpOnly cookie as a Bearer to the cross-origin API, so the
 * MediaRecorder blob is POSTed to THIS route (same-origin), which reads the
 * session cookie server-side and forwards the multipart body to
 * `POST {API_BASE_URL}/plan-specs/transcribe` as a Bearer, streaming with
 * `duplex: "half"`. The upstream `{ text, unclear }` JSON and its status are
 * passed through verbatim — a Free user's 403, an oversize 413, an
 * unsupported-format 415, and a transport 502 all surface unchanged so the
 * client can react. No token ever reaches the browser; no LLM import here.
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

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/plan-specs/transcribe`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        authorization: `Bearer ${token}`,
      },
      body: request.body,
      signal: request.signal,
      cache: "no-store",
      // undici requires `duplex` when a body is streamed.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch {
    // Never leak the internal API URL — a generic unreachable error only.
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
