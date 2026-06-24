import { expect, test } from "@playwright/test";

/**
 * Responsive design system (spec: 06-v1-mobile-foundation — 320px–1920px,
 * ≥44px tap targets, Open Design OKLch tokens).
 */

const PAGES = ["/?lang=en", "/login", "/sign-up", "/dashboard"];

const VIEWPORTS = [
  { name: "375x812 (iPhone X)", width: 375, height: 812 },
  { name: "768x1024 (tablet)", width: 768, height: 1024 },
  { name: "1280x800 (desktop)", width: 1280, height: 800 },
  { name: "1920x1080 (large desktop)", width: 1920, height: 1080 },
];

test.describe("Design tokens (06-TST 3.6)", () => {
  test("CSS custom properties resolve to the design-system palette", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    // IMPORTANT — toolchain note:
    // The palette in apps/web/src/app/globals.css is authored in oklch():
    //   --bg:      oklch(5% 0.006 270)   (near-black, cold/blue hue 270)
    //   --surface: oklch(11% 0.006 270)  (dark surface, same hue)
    //   --accent:  oklch(89% 0.2 128)    (lime green, hue ~128)
    // But Lightning CSS (via Turbopack) TRANSPILES oklch() to lab() at build
    // time, so getComputedStyle().getPropertyValue("--bg") returns e.g.
    // "lab(.11031% .0139847 -.155863)" at runtime. The literal "oklch"/"270"/
    // "128" substrings no longer exist even though the COLOR is identical.
    // Asserting on authored syntax is therefore brittle. Instead we resolve
    // each token to its actual computed RGB (via a probe element) and assert
    // the design INTENT: bg/surface are dark (low luminance) and the accent is
    // green-ish (green channel dominates). This still FAILS if someone swaps
    // the palette to a light theme or a non-green accent.

    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      // Resolve a CSS color token to concrete sRGB [r, g, b] (0..255),
      // color-space agnostic. getComputedStyle does NOT normalize lab()/oklch()
      // to rgb() (it returns e.g. "lab(89.18 -37.87 68.8)"), so we paint the
      // color onto a canvas and read the rasterized pixel — the browser does
      // the lab/oklch→sRGB conversion for us regardless of authored syntax.
      const resolveColor = (value: string): [number, number, number] => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b];
      };

      return {
        bgRgb: resolveColor(root.getPropertyValue("--bg").trim()),
        surfaceRgb: resolveColor(root.getPropertyValue("--surface").trim()),
        accentRgb: resolveColor(root.getPropertyValue("--accent").trim()),
        fontDisplay: root.getPropertyValue("--font-display").trim(),
        fontBody: root.getPropertyValue("--font-body").trim(),
      };
    });

    // Relative luminance (sRGB, 0..255 inputs) — a perceptual lightness proxy.
    const luminance = ([r, g, b]: number[]) =>
      0.2126 * r + 0.7152 * g + 0.0722 * b;

    // Surfaces are near-black (dark theme): very low luminance. A light theme
    // would push these well above the threshold and fail.
    expect(luminance(tokens.bgRgb)).toBeLessThan(40);
    expect(luminance(tokens.surfaceRgb)).toBeLessThan(60);

    // Brand accent is the lime green: the green channel must dominate both red
    // and blue. A non-green accent (e.g. a blue or red rebrand) fails here.
    const [ar, ag, ab] = tokens.accentRgb;
    expect(ag).toBeGreaterThan(ar);
    expect(ag).toBeGreaterThan(ab);

    // Fonts carry the Open Design families. Font-family tokens are NOT
    // transpiled, so the authored string survives and we assert it directly.
    expect(tokens.fontDisplay).toContain("Space Grotesk");
    expect(tokens.fontBody).toContain("DM Sans");

    // The body background computes to a dark (near-black) color — never white.
    const bodyBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    expect(bodyBg).not.toBe("rgb(255, 255, 255)");
    expect(bodyBg).not.toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("Responsive layout (06-TST 3.7)", () => {
  for (const vp of VIEWPORTS) {
    test(`renders without horizontal overflow at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const url of PAGES) {
        await page.goto(url);
        // Some pages redirect (e.g. /dashboard without a session) — wait for
        // a settled document and measure overflow against the layout viewport.
        await page.waitForLoadState("domcontentloaded");

        const overflow = await page.evaluate(() => {
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          };
        });
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

        // A heading or the offline/CTA content must remain visible (readable).
        const hasContent = await page.evaluate(() => {
          const text = (document.body?.innerText ?? "").trim();
          return text.length > 0;
        });
        expect(hasContent).toBe(true);
      }
    });
  }
});

test.describe("Tap targets ≥ 44px (06-TST 3.8)", () => {
  const INTERACTIVE = "button, a[href], [role='button']";

  for (const url of PAGES) {
    test(`interactive elements on ${url} meet the 44px minimum`, async ({
      page,
    }) => {
      // Set the mobile viewport BEFORE navigating so the 375px audit measures
      // the layout the user actually sees (previously the viewport was set
      // AFTER goto, auditing the default desktop layout — a pre-existing bug).
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(url);
      await page.waitForLoadState("domcontentloaded");

      // Audit the app's own VISIBLE interactive elements. Two refinements vs.
      // a raw document-wide query, NEITHER of which weakens the 44px contract:
      //   1. Scope to <main>. Every audited route renders its interactive
      //      content inside <main>: "/" (landing), "/login" + "/sign-up"
      //      (<main className="kin-page">), and "/dashboard" (redirects to
      //      /login without a session → also <main>). Scoping to <main>
      //      excludes the Next.js dev-tools button, which `next dev` injects
      //      into a body-level shadow-root portal (`nextjs-portal`): it is a
      //      32px <button> with no label, absent from production builds, and
      //      cannot be disabled via next.config `devIndicators` or app CSS.
      //      It is harness noise, not a kInorA UI element.
      //   2. Skip elements that are not rendered (offsetParent === null), e.g.
      //      nav links hidden on mobile. A non-rendered element is not a tap
      //      target. Every VISIBLE interactive element must still be >= 44px.
      const boxes = await page
        .locator("main")
        .locator(INTERACTIVE)
        .evaluateAll((els) =>
          els
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .map((el) => {
              const r = el.getBoundingClientRect();
              return {
                w: Math.round(r.width),
                h: Math.round(r.height),
                tag: el.tagName,
                label: (el.textContent ?? "").trim().slice(0, 24),
              };
            }),
        );

      // At least one interactive element exists on each page.
      expect(boxes.length).toBeGreaterThan(0);

      for (const b of boxes) {
        expect(
          b.h,
          `${b.tag} “${b.label}” height ${b.h} < 44`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          b.w,
          `${b.tag} “${b.label}” width ${b.w} < 44`,
        ).toBeGreaterThanOrEqual(44);
      }
    });
  }
});