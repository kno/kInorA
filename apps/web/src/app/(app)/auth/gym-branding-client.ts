import type { BrandingPalette } from "@kinora/contracts";

/** Own-tenant branding shape the `(app)` root layout needs to theme itself. */
export interface OwnBrandingDTO {
  logoUrl: string | null;
  palette: BrandingPalette;
}

/**
 * Discriminated result of the own-tenant branding fetch. Unlike a plain
 * fail-safe-to-null value, this distinguishes a NON-gym tenant (`forbidden`,
 * 403 from `assertGymEntitled`) from a gym tenant with no branding row yet
 * (`not_found`, 404) — both fall back to default branding styling, but ONLY
 * `forbidden` means the tenant is not gym-tier. The `(app)` layout uses this
 * distinction to gate the gym Branding Studio nav entry (GH #322) without a
 * second endpoint or fetch.
 */
export type OwnBrandingResult =
  | { kind: "ok"; data: OwnBrandingDTO }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "error" };

/**
 * Server-side fetch of the AUTHENTICATED S3 `GET /branding` endpoint (16a-
 * v3-gym-white-label, Slice 5), consumed by the `(app)` root layout to theme
 * the whole app for a logged-in gym member and, as of GH #322, to derive
 * whether the tenant is gym-tier for nav gating.
 */
export async function fetchOwnBranding(token: string): Promise<OwnBrandingResult> {
  const base = process.env.API_BASE_URL ?? "http://localhost:4000";

  let res: Response;
  try {
    res = await fetch(`${base}/branding`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { kind: "error" };
  }

  if (res.status === 403) return { kind: "forbidden" };
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "error" };

  const payload = (await res.json().catch(() => null)) as Partial<OwnBrandingDTO> | null;
  if (!payload?.palette) return { kind: "error" };

  return {
    kind: "ok",
    data: {
      logoUrl: payload.logoUrl ?? null,
      palette: payload.palette,
    },
  };
}
