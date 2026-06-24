import { expect, test } from "@playwright/test";

/**
 * PWA baseline (spec: 06-v1-mobile-foundation — PWA install + offline fallback).
 *
 * The manifest and offline fallback route are static assets/pages served in
 * every environment, so those checks run against the configured dev server.
 * The live service-worker precache/offline simulation requires a production
 * build (Serwist is disabled in development, see `next.config.ts`), so it is
 * guarded to run only when `/sw.js` is reachable — e.g. against `next start`.
 */

const ROUTES = ["/", "/login", "/sign-up", "/dashboard"];

test.describe("PWA manifest (06-TST 2.8)", () => {
  test("manifest.json is served with the required fields", async ({ request }) => {
    const res = await request.get("/manifest.json");

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("json");

    const manifest = await res.json();
    expect(manifest.name).toMatch(/kInorA/i);
    expect(manifest.short_name).toMatch(/kInorA/i);
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const hasMaskable = manifest.icons.some(
      (i: { purpose?: string }) => i.purpose?.includes("maskable"),
    );
    expect(hasMaskable).toBe(true);

    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  test("every page links the manifest and apple-touch icon", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(`${route}?lang=en`);
      await expect(
        page.locator('link[rel="manifest"]'),
      ).toHaveAttribute("href", "/manifest.json");
    }
    // Apple touch icon is emitted once in the root layout head.
    await page.goto("/?lang=en");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });
});

test.describe("Offline fallback (06-TST 2.9)", () => {
  test("the /offline route renders the branded fallback page", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: /offline/i })).toBeVisible();
    await expect(
      page.getByText(/disconnected from the internet/i),
    ).toBeVisible();
    // Branded dark surface: background resolves to a dark color, not white.
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).not.toBe("rgb(255, 255, 255)");
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("service worker registers and serves the offline fallback when offline (production)", async ({
    page,
    request,
  }) => {
    // The live SW precache/offline path requires a production build where
    // Serwist is enabled. Skip against the dev server (sw.js not emitted).
    const sw = await request.get("/sw.js");
    test.skip(sw.status() !== 200, "/sw.js not served — dev server has Serwist disabled");

    await page.goto("/?lang=en");
    await expect(page).toHaveTitle(/kInorA/);

    // Wait for the service worker to take control, then force offline.
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      void reg;
    });
    await page.context().setOffline(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      // The SW serves the cached app or the offline fallback document.
      await expect(
        page.getByRole("heading", { name: /offline|kInorA/i }),
      ).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
  });
});