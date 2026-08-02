import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  BillingTier,
  BrandingPalette,
  LogoUploadResponseDTO,
  TenantBrandingDTO,
  TenantId,
} from "../index";

/**
 * Gym white-label branding (16a v3, Slice 1) — additive contract surface.
 *
 * Slice 1 is dark/additive: no route or behavior change. This only proves the
 * `BillingTier` union gained the `gym` value and the branding DTOs are shaped
 * exactly per design.md's "Interfaces / Contracts" section, without
 * disturbing any existing consumer of these types.
 */
describe("gym white-label branding contracts (16a v3 Slice 1)", () => {
  it("extends BillingTier with 'gym' while keeping the existing values", () => {
    expectTypeOf<BillingTier>().toEqualTypeOf<"free" | "pro" | "trainer" | "gym">();
    const tier: BillingTier = "gym";
    expect(tier).toBe("gym");
  });

  it("defines BrandingPalette as exactly the six hex-validated palette tokens", () => {
    expectTypeOf<BrandingPalette>().toEqualTypeOf<{
      accent: string | null;
      accentFg: string | null;
      surface: string | null;
      surface2: string | null;
      fg: string | null;
      muted: string | null;
    }>();
    const palette: BrandingPalette = {
      accent: "#112233",
      accentFg: null,
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    };
    expect(palette.accent).toBe("#112233");
  });

  it("defines TenantBrandingDTO per design's Interfaces/Contracts shape", () => {
    expectTypeOf<TenantBrandingDTO>().toEqualTypeOf<{
      tenantId: TenantId;
      subdomainSlug: string;
      logoUrl: string | null;
      palette: BrandingPalette;
    }>();
  });

  it("defines LogoUploadResponseDTO as a stable logo URL payload", () => {
    expectTypeOf<LogoUploadResponseDTO>().toEqualTypeOf<{ logoUrl: string }>();
  });
});
