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

const DEFAULT_APEX_HOST = "kinora.aitsai.com";

function apexHost(): string {
  return (process.env.NEXT_PUBLIC_APEX_HOST ?? DEFAULT_APEX_HOST).toLowerCase();
}

export function extractGymSlugFromHost(
  hostHeader: string | null | undefined
): string | null {
  if (!hostHeader) return null;

  const host = hostHeader.split(":")[0]!.trim().toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1") return null;

  const apex = apexHost();
  if (host === apex || host === `www.${apex}`) return null;

  const suffix = `.${apex}`;
  if (!host.endsWith(suffix)) return null;

  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain || subdomain === "www" || subdomain.includes(".")) return null;

  return subdomain;
}
