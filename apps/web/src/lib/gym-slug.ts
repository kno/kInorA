/**
 * Host → gym `subdomainSlug` resolution (16a-v3-gym-white-label, Slice 4).
 *
 * Pure, framework-free string parsing so it is unit-testable in isolation
 * from the login page's Server Component rendering. The reverse-proxy
 * wildcard routing (`*.kinora.aitsai.com → web`) that would make this
 * resolvable end-to-end in prod is an external, tracked prerequisite
 * (design.md's Migration/Rollout section) — this function is correct
 * regardless of that infra landing.
 *
 * Resolution rules:
 *  - the bare apex domain, its `www.` alias, `localhost` (with or without a
 *    port), or any host that does not end in the apex → no slug (`null`).
 *  - exactly one label ahead of the apex → that label, lowercased, is the
 *    slug (e.g. `gymname.kinora.aitsai.com` → `gymname`).
 *  - more than one extra label (e.g. `sub.gymname.kinora.aitsai.com`) → no
 *    slug; multi-level gym subdomains are out of scope for this change.
 */

export const DEFAULT_APEX_HOST = "kinora.aitsai.com";

/**
 * A single DNS label: lowercase alphanumerics + hyphens, 1..63 chars. This is
 * the strict allow-list a gym slug must satisfy before it is ever interpolated
 * into a redirect target — it rejects dots, slashes, protocol-relative
 * prefixes, and anything else that could smuggle in a host or path.
 */
const SLUG_PATTERN = /^[a-z0-9-]{1,63}$/;

/**
 * The apex host the white-label subdomains hang off, e.g.
 * `kinora.aitsai.com`. Overridable via `NEXT_PUBLIC_APEX_HOST` for
 * non-production environments.
 */
export function getApexHost(): string {
  return (process.env.NEXT_PUBLIC_APEX_HOST ?? DEFAULT_APEX_HOST).toLowerCase();
}

export function extractGymSlugFromHost(
  hostHeader: string | null | undefined
): string | null {
  if (!hostHeader) return null;

  const host = hostHeader.split(":")[0]!.trim().toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1") return null;

  const apex = getApexHost();
  if (host === apex || host === `www.${apex}`) return null;

  const suffix = `.${apex}`;
  if (!host.endsWith(suffix)) return null;

  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain || subdomain === "www" || subdomain.includes(".")) return null;

  return subdomain;
}

/**
 * Validate + normalize an untrusted gym slug (e.g. one round-tripped through
 * the OAuth state and returned by the API) to a safe single DNS label, or
 * `null` if it is not one.
 *
 * SECURITY: this is the open-redirect guard for part B of the multi-tenant
 * OAuth fix. The returned value is the ONLY thing allowed to be interpolated
 * into `https://<slug>.<apex>` — never a raw host/URL. It rejects anything
 * containing dots (`evil.com`, `a.b`), slashes (`//evil`, `../`), the `www`
 * alias, empty strings, and over-long labels.
 */
export function sanitizeGymSlug(
  slug: string | null | undefined
): string | null {
  if (!slug) return null;
  const normalized = slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(normalized)) return null;
  if (normalized === "www") return null;
  return normalized;
}
