import { expect, test } from "@playwright/test";

/**
 * Authenticated AppShell navigation (issue #18).
 *
 * Exercises the full stack end-to-end: register a fresh user through the real
 * `/sign-up` UI (which POSTs to the API `POST /auth/register`, sets the
 * `kinora_session` cookie, and redirects), then drive the authenticated app
 * shell. This requires the API and a migrated Postgres to be up — booted by
 * the `scripts/e2e-with-stack.mjs` orchestrator that wraps `pnpm test:e2e`.
 *
 * Coverage:
 *   - The desktop AppShell (sidebar) renders on `(app)/*` routes.
 *   - Each sidebar link navigates to its route AND becomes the active item
 *     (`aria-current="page"`).
 *   - On a 375px viewport the mobile bottom navigation is visible.
 */

/** Sidebar items mirror `apps/web/src/components/AppShell/SidebarNav.tsx`. */
const SIDEBAR_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Plan", href: "/plan" },
  { label: "Statistics", href: "/stats" },
  { label: "Create Plan", href: "/create-plan" },
  { label: "Exercises", href: "/exercises" },
] as const;

/** A viewport wide enough for the AppShell to mount the desktop sidebar. */
const DESKTOP = { width: 1280, height: 800 };
/** A mobile viewport for the bottom-nav assertion. */
const MOBILE = { width: 375, height: 812 };

/**
 * Register a unique user through the real sign-up UI and return once the
 * session cookie is set. The sign-up server action redirects to `/` on
 * success; we then navigate into a protected route to reach the AppShell.
 */
async function registerFreshUser(page: import("@playwright/test").Page) {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e+${unique}@kinora.test`;
  const password = "Sup3rSecret!pw";

  await page.goto("/sign-up");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);

  // The server action sets the `kinora_session` cookie and redirects to `/`.
  // A FAILED registration redirects back to `/sign-up?error=...`, so a
  // navigation away from `/sign-up` is itself the success signal — this
  // step fails loudly (timeout) on a failed signup.
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-up"), {
      timeout: 30_000,
    }),
    page.click("button[type=submit]"),
  ]);

  // Confirm the session cookie is actually set (defence against a redirect
  // that lands off `/sign-up` without a session).
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name === "kinora_session" && c.value.length > 0),
    "sign-up should set the kinora_session cookie",
  ).toBe(true);

  return { email, password };
}

test.describe("Authenticated AppShell navigation (#18)", () => {
  test("desktop sidebar navigates and highlights the active route", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await registerFreshUser(page);

    // Enter the authenticated app. The proxy passes because the session
    // cookie is present; `(app)/layout.tsx` wraps the page in the AppShell.
    await page.goto("/dashboard");

    const sidebar = page.getByRole("complementary", {
      name: "Main navigation",
    });
    await expect(sidebar).toBeVisible();

    for (const item of SIDEBAR_ITEMS) {
      const link = sidebar.getByRole("link", { name: item.label, exact: true });
      await link.click();
      await page.waitForURL(`**${item.href}`);
      expect(new URL(page.url()).pathname).toBe(item.href);

      // The clicked item is the active one (left accent indicator).
      await expect(
        sidebar.getByRole("link", { name: item.label, exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
  });

  test("mobile bottom navigation is visible on a 375px viewport", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await registerFreshUser(page);

    await page.goto("/dashboard");

    const mobileNav = page.getByRole("navigation", {
      name: "Mobile navigation",
    });
    await expect(mobileNav).toBeVisible();
  });
});
