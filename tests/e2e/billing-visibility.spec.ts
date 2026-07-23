import { expect, test, type Page } from "@playwright/test";

/**
 * Billing UI end-to-end coverage (issue #179).
 *
 * The 11a billing UI states were previously proven only in PIECES (route unit
 * tests + BillingPageClient component tests with mocked data), never as ONE
 * live end-to-end session against the real stack. This spec closes that gap by
 * driving `/billing` through the real Next.js app + Fastify API + migrated
 * Postgres booted by `scripts/e2e-with-stack.mjs`.
 *
 * WHAT IS COVERED HERE (deterministic against THIS harness):
 *   1. An authenticated member sees the correct billing state for their tenant.
 *      Every freshly-registered tenant is provisioned a Pro / `trialing` 30-day
 *      trial (see `buildTrialBillingState` in
 *      apps/api/src/db/repositories/billing-backfill.ts), so a fresh sign-up
 *      deterministically renders: Pro tier, Trial status, the trial-days badge,
 *      and the empty-usage state (no quota consumed yet).
 *   2. The error state — `/billing` is intentionally NOT in the proxy's
 *      protected-path list (see apps/web/src/proxy.ts), so an unauthenticated
 *      visit renders the in-page error card (`no_session`) rather than
 *      redirecting. This is a stable, infra-free way to prove the error card.
 *   3. Session-reissue refresh. There is NO tenant-switcher UI (confirmed by
 *      prior reviews); switching the active tenant is only possible by
 *      (re)issuing the `kinora_session` cookie. This test starts in the error
 *      state (no session), (re)issues a session for a real tenant, then drives
 *      the in-UI Retry — proving the client refresh loads the current session's
 *      billing state and clears the error card (spec: "Tenant switching
 *      refreshes billing"). NOTE: this starts from a null-data error state, so
 *      it does NOT by itself distinguish replace-from-merge — the genuine
 *      Free→Pro replace-not-merge invariant is covered by the component unit
 *      test and manual QA step (see below).
 *
 * WHAT IS NOT COVERED HERE (documented as manual QA — see
 * docs/billing/QA-CHECKLIST.md): the loading and offline cards (both require a
 * server-side fetch stall/failure that cannot be driven from the browser, since
 * the billing read runs in a Server Action / RSC, not a browser fetch); and the
 * VISUAL Free-vs-Pro replace-not-merge on a tenant switch, which needs a
 * DB-seeded Free tenant (a fresh registration is always Pro/trialing, so two
 * registered tenants render identically). Those are covered by the component
 * unit tests (apps/web/.../billing/__tests__/BillingPageClient.test.tsx) plus
 * the manual checklist.
 *
 * Requires the api + migrated Postgres booted by `scripts/e2e-with-stack.mjs`.
 */

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

/** Web origin the Playwright browser targets (matches playwright.config.ts baseURL). */
const WEB_ORIGIN = "http://127.0.0.1:3000";

/**
 * Register a unique user through the real sign-up UI and return once the
 * `kinora_session` cookie is set. Mirrors the helper in authenticated-nav.spec.ts:
 * a failed sign-up redirects back to `/sign-up?error=...`, so a navigation away
 * from `/sign-up` is itself the success signal.
 */
async function registerFreshUserViaUi(page: Page): Promise<void> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e+billing-${unique}@kinora.test`;

  await page.goto("/sign-up");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "Sup3rSecret!pw");

  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-up"), {
      timeout: 30_000,
    }),
    page.click("button[type=submit]"),
  ]);

  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name === "kinora_session" && c.value.length > 0),
    "sign-up should set the kinora_session cookie",
  ).toBe(true);
}

/** Register a fresh user via the real API and return its opaque session token. */
async function registerViaApi(page: Page): Promise<string> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e+billing-api-${unique}@kinora.test`;
  const res = await page.request.post(`${API_BASE}/auth/register`, {
    data: { email, password: "Sup3rSecret!pw" },
  });
  expect(res.ok(), "registration should succeed").toBeTruthy();
  const body = (await res.json()) as { token: string };
  expect(body.token, "register should return a session token").toBeTruthy();
  return body.token;
}

test.describe("Billing visibility UI (#179)", () => {
  test("an authenticated member sees their tenant's Pro trial state and empty usage", async ({
    page,
  }) => {
    await registerFreshUserViaUi(page);

    await page.goto("/billing");

    // Page shell.
    await expect(
      page.getByRole("heading", { name: "Billing", level: 1 }),
    ).toBeVisible();

    // A fresh tenant is provisioned Pro / trialing for 30 days.
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    await expect(page.getByText("Trial", { exact: true })).toBeVisible();
    // Trial-days badge — assert on the stable prefix, not the exact day count.
    await expect(page.getByText(/Pro trial/)).toBeVisible();

    // No quota consumed yet → the empty-usage card, not the usage lists.
    await expect(page.getByText("No usage recorded yet")).toBeVisible();

    // Neither the "trial ended" block nor the upgrade prompt should show for an
    // active, unexpired Pro trial.
    await expect(page.getByText("Your Pro trial has ended")).toHaveCount(0);
    await expect(page.getByText("Unlock Pro features")).toHaveCount(0);
  });

  test("an unauthenticated visit to /billing renders the error card with a retry action", async ({
    page,
  }) => {
    // No session cookie. `/billing` is not proxy-protected, so the server
    // component resolves `no_session` and renders the in-page error card.
    await page.context().clearCookies();

    await page.goto("/billing");

    await expect(
      page.getByText("We could not load your billing."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("reissuing the session refreshes billing and clears the error card", async ({
    page,
  }) => {
    // Start unauthenticated → error card (no tenant-switcher UI exists; the only
    // way to change the active tenant is to (re)issue the session cookie).
    await page.context().clearCookies();
    await page.goto("/billing");
    await expect(
      page.getByText("We could not load your billing."),
    ).toBeVisible();

    // Reissue a session for a real, freshly-provisioned tenant (Pro trial).
    const token = await registerViaApi(page);
    await page.context().addCookies([
      { name: "kinora_session", value: token, url: WEB_ORIGIN },
    ]);

    // Drive the in-UI refresh. The Server Action reads the CURRENT cookie, so
    // this surfaces the newly-active tenant's billing state.
    await page.getByRole("button", { name: "Retry" }).click();

    // The error card is cleared and the current session's billing state renders.
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    await expect(page.getByText("Trial", { exact: true })).toBeVisible();
    await expect(page.getByText(/Pro trial/)).toBeVisible();
    await expect(
      page.getByText("We could not load your billing."),
    ).toHaveCount(0);
  });
});
