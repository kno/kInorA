/**
 * White-label host guard for the Next.js proxy (16a-v3-gym-white-label).
 *
 * When a request arrives for a gym SUBDOMAIN that is NOT configured (no gym
 * branding exists for that slug), the browser is redirected to the MAIN
 * (apex) domain. Configured subdomains and the apex itself are unaffected.
 *
 * Mirrors the `evaluateAuthGate` split: `resolveHostRedirect` is the PURE,
 * I/O-free decision (fully unit-testable) and `isGymSlugConfigured` owns the
 * single cached, fail-open network lookup. The proxy wraps both: it resolves
 * the slug, calls `isGymSlugConfigured` only when a slug is present, then
 * `resolveHostRedirect`, and returns a 307 redirect on `kind: "redirect"`.
 *
 * FAIL-OPEN: a network error or any non-200/non-404 response resolves to
 * "unknown" ⇒ pass-through. An API outage must never send all gym traffic to
 * the apex.
 */

import { extractGymSlugFromHost } from "@/lib/gym-slug";

export type HostRedirectResult =
  | { kind: "redirect"; location: string }
  | { kind: "pass" };

/**
 * Pure redirect decision. Resolves the gym slug from the host itself, so it
 * never redirects the apex, `www.`, `localhost`, or an unrelated host (all
 * yield no slug ⇒ pass, which also guarantees the apex can never loop).
 *
 * Only an unconfigured slug (`isConfigured === false`) redirects. A configured
 * slug (`true`) or an unresolved lookup (`"unknown"`, fail-open) passes.
 */
export function resolveHostRedirect(input: {
  host: string | null | undefined;
  pathname: string;
  search: string;
  apexHost: string;
  isConfigured: true | false | "unknown";
}): HostRedirectResult {
  const slug = extractGymSlugFromHost(input.host);

  // No slug ⇒ apex / www / localhost / unrelated host ⇒ never redirect.
  if (!slug) return { kind: "pass" };

  if (input.isConfigured === false) {
    // Swap only the host to the apex; preserve the pathname + query string.
    return {
      kind: "redirect",
      location: `https://${input.apexHost}${input.pathname}${input.search}`,
    };
  }

  // Configured (true) or fail-open ("unknown") ⇒ render normally.
  return { kind: "pass" };
}

/** Short-lived positive/negative cache TTL (5 minutes). */
const CONFIG_TTL_MS = 300_000;

/**
 * Module-level in-memory cache of DEFINITIVE lookups only. `Date.now()` is
 * used for expiry — this is request-time middleware, not a workflow script.
 */
const configCache = new Map<string, { configured: boolean; expiresAt: number }>();

/**
 * Resolve whether a gym slug is configured by calling the PUBLIC,
 * unauthenticated `GET {API_BASE_URL}/public/branding/by-slug/:slug` endpoint
 * (the same one `fetchPublicBranding` uses).
 *
 *  - HTTP 200 ⇒ `true`  (configured; cached for the TTL)
 *  - HTTP 404 ⇒ `false` (not configured; cached for the TTL)
 *  - network error / any other status ⇒ `"unknown"` (fail-open; NOT cached,
 *    so a transient error is retried on the next request)
 */
export async function isGymSlugConfigured(
  slug: string
): Promise<true | false | "unknown"> {
  const now = Date.now();
  const cached = configCache.get(slug);
  if (cached && cached.expiresAt > now) {
    return cached.configured;
  }

  const base = process.env.API_BASE_URL ?? "http://localhost:4000";

  let res: Response;
  try {
    res = await fetch(
      `${base}/public/branding/by-slug/${encodeURIComponent(slug)}`
    );
  } catch {
    return "unknown";
  }

  if (res.status === 200) {
    configCache.set(slug, { configured: true, expiresAt: now + CONFIG_TTL_MS });
    return true;
  }

  if (res.status === 404) {
    configCache.set(slug, { configured: false, expiresAt: now + CONFIG_TTL_MS });
    return false;
  }

  // Any other status is treated as an outage ⇒ fail-open, and NOT cached.
  return "unknown";
}

/** Test-only: reset the module-level config cache between cases. */
export function __clearGymSlugConfigCache(): void {
  configCache.clear();
}
