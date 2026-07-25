import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/auth/session-cookie";

/**
 * Same-origin SSE proxy for the Asistente chat turn (12 Slice 3).
 *
 * The browser cannot attach the `kinora_session` httpOnly cookie as a Bearer to
 * the cross-origin API, and `EventSource` cannot POST. So the client POSTs the
 * message to THIS route (same-origin), which reads the session cookie
 * server-side, forwards it to `POST {API_BASE_URL}/plan-specs/chat` as a Bearer,
 * and streams the upstream `text/event-stream` body straight back to the
 * client. The client's `AbortController` (aborted on unmount/navigation)
 * propagates via `request.signal` → the upstream fetch → the API's disconnect
 * handling, so an aborted turn writes no draft.
 *
 * Thin transport glue (mirrors `actions.ts`): the real logic — the Pro gate,
 * masking, extraction, draft commit — lives in the API. No LLM import here.
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
    upstream = await fetch(`${apiBaseUrl()}/plan-specs/chat`, {
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
    return jsonError("api_unreachable", 502);
  }

  // A gate denial (403 premium_required) or any non-stream error passes through
  // as-is so the client can react (Free should never reach here — the UI shows a
  // teaser — but the server gate is the real enforcement).
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || JSON.stringify({ error: "chat_failed" }), {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
