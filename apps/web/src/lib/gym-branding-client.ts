import type { PublicBrandingDTO } from "@kinora/contracts";

/**
 * Server-side fetch of the PUBLIC, unauthenticated `GET
 * /public/branding/by-slug/:slug` endpoint (16a-v3-gym-white-label, Slice 3),
 * consumed pre-login by the Slice 4 login page.
 *
 * Mirrors `apps/web/src/app/(app)/auth/profile-client.ts`'s
 * fail-safe-to-null shape: no slug match (404), any other non-OK response,
 * a network error, or a malformed payload all resolve to `null` so the
 * login page can fall back to default kInorA branding with no server error
 * (spec.md "Login Page Host-Resolved Theming", unknown-slug scenario).
 *
 * No secrets and no session are involved — this is a read-only, unauthenticated
 * call.
 */
export async function fetchPublicBranding(
  slug: string
): Promise<PublicBrandingDTO | null> {
  const base = process.env.API_BASE_URL ?? "http://localhost:4000";

  let res: Response;
  try {
    res = await fetch(`${base}/public/branding/by-slug/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const payload = (await res.json().catch(() => null)) as Partial<PublicBrandingDTO> | null;
  if (!payload?.palette) return null;

  return {
    logoUrl: payload.logoUrl ?? null,
    palette: payload.palette,
  };
}
