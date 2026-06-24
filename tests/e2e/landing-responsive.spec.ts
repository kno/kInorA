import { expect, test } from "@playwright/test";

/**
 * Responsive landing page viewport tests (spec: 06b-v1-orbit-ui-shell).
 * Verifies the landing renders correctly at 375px, 768px, 1280px, 1920px.
 */

const VIEWPORTS = [
  { name: "375px (mobile)", width: 375, height: 812 },
  { name: "768px (tablet)", width: 768, height: 1024 },
  { name: "1280px (desktop)", width: 1280, height: 800 },
  { name: "1920px (large desktop)", width: 1920, height: 1080 },
];

test.describe("Landing page responsive (06B-TST 1.8)", () => {
  for (const vp of VIEWPORTS) {
    test(`renders without horizontal overflow at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?lang=en");
      await page.waitForLoadState("networkidle");

      // No horizontal overflow
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

      // Hero section is visible and readable
      await expect(page.getByText("AI Coach")).toBeVisible();
      await expect(page.getByText("Start free").first()).toBeVisible();

      // Navigation brand is visible
      await expect(page.getByText("kInorA").first()).toBeVisible();

      // Scroll to verify lower sections render
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);

      // Footer content is visible after scrolling
      await expect(page.getByText(/all rights reserved/i)).toBeVisible();
    });

    test(`all interactive elements meet 44px tap target at ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?lang=en");
      await page.waitForLoadState("networkidle");

      const interactive = "button, a[href], [role='button']";
      const boxes = await page.locator(interactive).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            w: Math.round(r.width),
            h: Math.round(r.height),
            tag: el.tagName,
            label: (el.textContent ?? "").trim().slice(0, 32),
          };
        }),
      );

      expect(boxes.length).toBeGreaterThan(0);

      for (const b of boxes) {
        expect(b.h, `${b.tag} "${b.label}" height ${b.h} < 44`).toBeGreaterThanOrEqual(44);
        expect(b.w, `${b.tag} "${b.label}" width ${b.w} < 44`).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test("landing page has the correct page title", async ({ page }) => {
    await page.goto("/?lang=en");
    await expect(page).toHaveTitle("kInorA — Personalized Training");
  });

  test("landing sections are present in the DOM", async ({ page }) => {
    await page.goto("/?lang=en");
    await page.waitForLoadState("networkidle");

    // All major sections should be present
    await expect(page.getByText("How it works").first()).toBeVisible();
    await expect(page.getByText("Your next routine is waiting")).toBeVisible();

    // Pricing section is present
    await expect(page.getByText("Pro").first()).toBeVisible();

    // Trust strip is present
    await expect(page.getByText("Adapts to your schedule").first()).toBeVisible();
  });
});
