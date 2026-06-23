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
  test("CSS custom properties resolve to the expected OKLch values", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        bg: root.getPropertyValue("--bg").trim(),
        surface: root.getPropertyValue("--surface").trim(),
        fg: root.getPropertyValue("--fg").trim(),
        muted: root.getPropertyValue("--muted").trim(),
        accent: root.getPropertyValue("--accent").trim(),
        accentFg: root.getPropertyValue("--accent-fg").trim(),
        fontDisplay: root.getPropertyValue("--font-display").trim(),
        fontBody: root.getPropertyValue("--font-body").trim(),
      };
    });

    // Surfaces anchored in the 270 hue (blue/cold near-black).
    expect(tokens.bg).toContain("oklch");
    expect(tokens.bg).toContain("270");
    expect(tokens.surface).toContain("270");

    // Brand accent is the lime green (hue ~128).
    expect(tokens.accent).toContain("oklch");
    expect(tokens.accent).toContain("128");

    // Fonts carry the Open Design families.
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
      await page.goto(url);
      await page.setViewportSize({ width: 375, height: 812 });

      const boxes = await page.locator(INTERACTIVE).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, tag: el.tagName, label: (el.textContent ?? "").trim() };
        }),
      );

      // At least one interactive element exists on each page.
      expect(boxes.length).toBeGreaterThan(0);

      for (const b of boxes) {
        const h = Math.round(b.h);
        const w = Math.round(b.w);
        expect(
          h,
          `${b.tag} “${b.label.slice(0, 24)}” height ${h} < 44`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          w,
          `${b.tag} “${b.label.slice(0, 24)}” width ${w} < 44`,
        ).toBeGreaterThanOrEqual(44);
      }
    });
  }
});