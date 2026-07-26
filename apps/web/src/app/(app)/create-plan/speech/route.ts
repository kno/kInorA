import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";

/**
 * Same-origin TTS proxy for web voice playback (13 Slice B2).
 *
 * Mirrors the chat/transcribe proxies (`../chat/route.ts`, `../transcribe/route.ts`):
 * the browser cannot attach the `kinora_session` httpOnly cookie as a Bearer to
 * the cross-origin API, so the client POSTs the terminal `assistantMessage`
 * `{ text }` to THIS route (same-origin), which reads the session cookie
 * server-side and forwards it to `POST {API_BASE_URL}/plan-specs/speech` as a
 * Bearer, streaming with `duplex: "half"`.
 *
 * The upstream taxonomy passes through faithfully so the client can react:
 *   - 200 `audio/mpeg`  → the mp3 body + its content-type stream straight back
 *     (the browser plays it via `<audio>`; the audio is generated in-flight
 *     upstream and never persisted — this proxy holds no state).
 *   - 204 No Content    → TTS opted out; passed through bodyless so the client
 *     simply skips playback with no error.
 *   - 403 / 502         → the JSON error body passes through verbatim.
 * No token ever reaches the browser; no LLM/audio import here.
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

  const body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/plan-specs/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body,
      signal: request.signal,
      cache: "no-store",
      // undici requires `duplex` when a body is streamed.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch {
    // Never leak the internal API URL — a generic unreachable error only.
    return jsonError("api_unreachable", 502);
  }

  // TTS opted out upstream → a bodyless 204 so the client skips playback quietly.
  // Checked BEFORE the ok/audio branch (204 is within the 2xx range).
  if (upstream.status === 204) {
    return new Response(null, { status: 204 });
  }

  // 200 audio → stream the mp3 body back with its content-type intact.
  if (upstream.ok && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
      },
    });
  }

  // 403 (Free) / 502 (synthesis failed) / any other non-2xx → pass the JSON
  // error through verbatim so the client can react (a Pro voice user should
  // never hit 403 here — the mic only appears in the Pro flow — but the server
  // gate is the real enforcement).
  const text = await upstream.text().catch(() => "");
  return new Response(text || JSON.stringify({ error: "synthesis_failed" }), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
