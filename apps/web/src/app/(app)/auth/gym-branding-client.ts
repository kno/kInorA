import type { BrandingPalette } from "@kinora/contracts";

/** Own-tenant branding shape the `(app)` root layout needs to theme itself. */
export interface OwnBrandingDTO {
  logoUrl: string | null;
  palette: BrandingPalette;
}

/**
 * Server-side fetch of the AUTHENTICATED S3 `GET /branding` endpoint (16a-
 * v3-gym-white-label, Slice 5), consumed by the `(app)` root layout to theme
 * the whole app for a logged-in gym member.
 *
 * Mirrors `apps/web/src/app/(app)/auth/profile-client.ts`'s fail-safe-to-null
 * shape exactly: a non-gym tenant (403 from `assertGymEntitled` — tier-only,
 * so this covers both owners and regular members of a non-gym tenant), a
 * gym tenant with no branding row yet (404), any other non-OK response, a
 * network error, or a malformed payload all resolve to `null` so the layout
 * falls back to default kInorA branding with no server error.
 */
export async function fetchOwnBranding(token: string): Promise<OwnBrandingDTO | null> {
  const base = process.env.API_BASE_URL ?? "http://localhost:4000";

  let res: Response;
  try {
    res = await fetch(`${base}/branding`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const payload = (await res.json().catch(() => null)) as Partial<OwnBrandingDTO> | null;
  if (!payload?.palette) return null;

  return {
    logoUrl: payload.logoUrl ?? null,
    palette: payload.palette,
  };
}
