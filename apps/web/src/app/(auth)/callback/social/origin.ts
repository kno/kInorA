/**
 * Resolves the public-facing origin of the web application in a proxy-aware
 * way. Behind a reverse proxy, `request.url` typically carries the internal
 * host (e.g. `localhost:3000`). This helper applies a priority-ordered
 * strategy so that OAuth callback redirects always land on the correct public
 * domain.
 *
 * Priority:
 * 1. `WEB_PUBLIC_ORIGIN` env var — authoritative override for deployments.
 * 2. `X-Forwarded-Proto` + `X-Forwarded-Host` headers — set by the reverse
 *    proxy (nginx / Caddy / Traefik). Only the first value of each header is
 *    used (comma-separated lists are split).
 * 3. `new URL(request.url).origin` — correct for local development where no
 *    proxy is involved.
 */
export function resolvePublicOrigin(request: Pick<Request, "url" | "headers">): string {
  // 1. Explicit env override.
  const envOrigin = process.env.WEB_PUBLIC_ORIGIN;
  if (envOrigin) {
    try {
      return new URL(envOrigin).origin;
    } catch {
      // Malformed — fall through to next strategy.
    }
  }

  // 2. Reverse-proxy forwarded headers.
  const proto = firstValue(request.headers.get("x-forwarded-proto"));
  const host = firstValue(request.headers.get("x-forwarded-host"));
  if (proto && host) {
    try {
      return new URL(`${proto}://${host}`).origin;
    } catch {
      // Malformed — fall through to next strategy.
    }
  }

  // 3. Derive from the raw request URL (works for local dev).
  return new URL(request.url).origin;
}

/** Takes the first element from a potentially comma-separated header value. */
function firstValue(header: string | null): string {
  if (!header) return "";
  return (header.split(",")[0] ?? "").trim();
}
