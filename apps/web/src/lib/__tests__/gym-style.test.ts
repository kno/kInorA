import { describe, expect, it } from "vitest";
import { buildGymStyleBlock } from "../gym-style";

/**
 * 16a-v3-gym-white-label, Slice 5 — direct unit coverage for the shared
 * palette→CSS builder, relocated from `(auth)/login/gym-style.ts` so both
 * the login page (Slice 4) and the `(app)` root layout (Slice 5) consume the
 * SAME implementation (no duplication).
 */
describe("buildGymStyleBlock", () => {
  it("emits a :root block with every non-null palette field as a --gym-* custom property", () => {
    const css = buildGymStyleBlock({
      accent: "#112233",
      accentFg: "#ffffff",
      surface: "#000000",
      surface2: "#111111",
      fg: "#eeeeee",
      muted: "#999999",
    });

    expect(css).toContain(":root{");
    expect(css).toContain("--gym-accent:#112233;");
    expect(css).toContain("--gym-accent-fg:#ffffff;");
    expect(css).toContain("--gym-surface:#000000;");
    expect(css).toContain("--gym-surface-2:#111111;");
    expect(css).toContain("--gym-fg:#eeeeee;");
    expect(css).toContain("--gym-muted:#999999;");
  });

  it("omits any null palette field instead of emitting an empty custom property", () => {
    const css = buildGymStyleBlock({
      accent: "#112233",
      accentFg: null,
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    });

    expect(css).toBe(":root{--gym-accent:#112233;}");
  });
});
