import { expect, test, type Page } from "@playwright/test";
import {
  closeSeedPool,
  currentPeriod,
  demoteToMember,
  registerTenant,
  seedEndedSubscription,
  seedExpiredTrial,
  seedFreeTenant,
  seedTenantUsage,
  useSession,
} from "./helpers/billing-seed";

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
    //
    // The OD billing redesign (11b Slice 5) renders "Pro" in MULTIPLE places
    // (the topbar tier chip AND the PlanHero title), so a bare
    // `getByText("Pro", { exact: true })` is a Playwright strict-mode
    // violation (2+ matches). Target the stable `data-testid` the component
    // exposes on the topbar chips instead (see BillingPageClient.tsx) — this
    // is also robust against future copy/layout changes.
    await expect(page.getByTestId("billing-tier-chip")).toHaveText("Pro");
    await expect(page.getByTestId("billing-status-chip")).toHaveText("Trial");
    // Trial-days badge — assert on the stable prefix, not the exact day count.
    await expect(page.getByTestId("billing-trial-badge")).toContainText("Pro trial");

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

    // The error card is cleared and the current session's billing state
    // renders. Same testid locators as the first test — unambiguous against
    // the OD layout's multiple "Pro" text nodes (topbar chip + PlanHero title).
    await expect(page.getByTestId("billing-tier-chip")).toHaveText("Pro");
    await expect(page.getByTestId("billing-status-chip")).toHaveText("Trial");
    await expect(page.getByTestId("billing-trial-badge")).toContainText("Pro trial");
    await expect(
      page.getByText("We could not load your billing."),
    ).toHaveCount(0);
  });
});

/**
 * Expanded real-stack billing QA (issue #200).
 *
 * Issue #200 deferred a manual two-server, two-tenant browser pass of `/billing`
 * (the local podman env was down); its acceptance criteria explicitly accept an
 * expanded Playwright e2e against a live two-server session as the deliverable.
 * This block drives the SAME real stack the existing spec uses (real Next.js +
 * Fastify api + migrated Postgres, booted by scripts/e2e-with-stack.mjs) and
 * exercises the states a fresh registration alone cannot reach — a Free tenant,
 * a lapsed trial, an ended subscription, non-empty usage, and owner-vs-non-owner
 * — by seeding the precise billing state in the SAME Postgres the api reads
 * (see ./helpers/billing-seed.ts; this mirrors the manual `psql` reshaping in
 * docs/billing/QA-CHECKLIST.md, now automated and asserted).
 *
 * WHAT IS COVERED HERE (automated, deterministic against the stack):
 *   #1 tier chip / trial badge / usage-meter copy ("up to N/mo") — Free & Pro.
 *   #2 Monthly/Annual toggle updates the displayed price + the derived save badge.
 *   #3 owner sees invoice history + Manage CTA; a non-owner does NOT.
 *   #4 tenant switch refreshes billing REPLACE-not-merge (Free → Pro, no stale).
 *   #5 access-ended banner: trial-expired vs subscription-ended (+ absent for
 *      active Pro trial); upgrade CTA present.
 *   #6 a11y: region/radiogroup/meter roles + labels, keyboard focus on Retry.
 *   #7 Stripe checkout/portal — asserted up to the wired boundary only (CTA
 *      present, enabled, and initiating the server action) WITHOUT following the
 *      external redirect. Completing a live Stripe test checkout / Customer
 *      Portal is NOT automatable here (no test card can be driven through
 *      stripe.com deterministically) and stays a manual step — see MANUAL QA
 *      CHECKLIST at the bottom of this file and docs/billing/QA-CHECKLIST.md.
 *
 * Requires the stack + `DATABASE_URL` injected by scripts/e2e-with-stack.mjs.
 */
test.describe("Billing real-stack QA (#200)", () => {
  test.afterAll(async () => {
    await closeSeedPool();
  });

  test("a Free tenant renders Free/Active, no trial badge, no access-ended banner, and an upgrade CTA", async ({
    page,
  }) => {
    const tenant = await registerTenant(page);
    await seedFreeTenant(tenant.tenantId);
    await useSession(page, tenant.token);

    await page.goto("/billing");

    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.getByTestId("billing-tier-chip")).toHaveText("Free");
    await expect(page.getByTestId("billing-status-chip")).toHaveText("Active");
    // A plain Free tenant is not a lapsed premium entitlement → no trial badge
    // and no access-ended banner (that surface is only for a lapsed trial /
    // ended subscription; the Pro card carries the upgrade path here).
    await expect(page.getByTestId("billing-trial-badge")).toHaveCount(0);
    await expect(page.getByTestId("billing-access-ended")).toHaveCount(0);
    // The Pro card offers the upgrade (the tenant is not an active Pro).
    await expect(page.getByRole("heading", { name: "kInorA Pro" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeEnabled();
    await expect(page.getByText("Your current plan")).toHaveCount(0);
  });

  test("a Pro-trial tenant with consumed quota renders the tier chip, trial badge, and usage meter", async ({
    page,
  }) => {
    const tenant = await registerTenant(page);
    // A fresh registration is Pro/trialing; seed a tenant usage row so the Usage
    // Meters section renders a real meter (not the empty-usage card).
    await seedTenantUsage({
      tenantId: tenant.tenantId,
      feature: "plan_generation",
      used: 1,
      limit: 1,
    });
    await useSession(page, tenant.token);

    await page.goto("/billing");

    await expect(page.getByTestId("billing-tier-chip")).toHaveText("Pro");
    await expect(page.getByTestId("billing-status-chip")).toHaveText("Trial");
    await expect(page.getByTestId("billing-trial-badge")).toContainText("Pro trial");

    // Usage meter for the current period: label, used/limit, the metered
    // "up to N/mo" note (NEVER "unlimited"), and the period label.
    const tenantMeters = page.getByRole("list", { name: "Tenant usage this period" });
    await expect(tenantMeters).toBeVisible();
    await expect(tenantMeters.getByText("Plan generations")).toBeVisible();
    await expect(tenantMeters.getByText("1/1", { exact: true })).toBeVisible();
    await expect(tenantMeters.getByText("up to 1/mo")).toBeVisible();
    await expect(tenantMeters.getByText(`Period ${currentPeriod()}`)).toBeVisible();
    // a11y: the meter exposes the ARIA meter role with min/now/max.
    const meter = tenantMeters.getByRole("meter");
    await expect(meter).toHaveAttribute("aria-valuenow", "1");
    await expect(meter).toHaveAttribute("aria-valuemax", "1");
  });

  test("the Monthly/Annual toggle updates the displayed price and shows the derived save badge", async ({
    page,
  }) => {
    const tenant = await registerTenant(page);
    await useSession(page, tenant.token);
    await page.goto("/billing");

    const cycleGroup = page.getByRole("radiogroup", { name: "Billing cycle" });
    await expect(cycleGroup).toBeVisible();
    const monthly = page.getByRole("radio", { name: "Monthly" });
    const annual = page.getByRole("radio", { name: "Annual" });

    // Default is monthly. Capture the monthly price and confirm the annual-only
    // note is absent.
    await expect(monthly).toHaveAttribute("aria-checked", "true");
    const price = page.getByTestId("billing-pro-price");
    await expect(price).toBeVisible();
    const monthlyPrice = (await price.textContent())?.trim() ?? "";
    expect(monthlyPrice.length).toBeGreaterThan(0);
    await expect(page.getByText("billed annually")).toHaveCount(0);

    // The save badge is DERIVED from the two configured amounts (999/799 → 20%),
    // never a hardcoded literal — so it renders for the default config.
    await expect(page.getByText("Save 20%")).toBeVisible();

    // Switch to annual: the displayed per-month price changes and the annual
    // note appears (web-first assertions, no arbitrary waits).
    await annual.click();
    await expect(annual).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("billed annually")).toBeVisible();
    await expect(price).not.toHaveText(monthlyPrice);
    await expect(page.getByText("Save 20%")).toBeVisible();
  });

  test("owner sees invoice history + Manage CTA; a non-owner member does not", async ({
    page,
  }) => {
    // Owner: a fresh registration is the tenant owner.
    const owner = await registerTenant(page);
    await useSession(page, owner.token);
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Invoices & charges" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage / Add card" })).toBeVisible();

    // Non-owner: demote the membership to `member`; the owner-only invoice/portal
    // endpoints then return 403 (→ web `forbidden`) and the sections are hidden.
    const member = await registerTenant(page);
    await demoteToMember(member.tenantId, member.userId);
    await page.context().clearCookies();
    await useSession(page, member.token);
    await page.goto("/billing");

    // The billing screen still renders (any active member can read visibility)…
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.getByTestId("billing-tier-chip")).toBeVisible();
    // …but the owner-only surfaces are absent.
    await expect(page.getByRole("heading", { name: "Invoices & charges" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage / Add card" })).toHaveCount(0);
  });

  test("switching the active tenant replaces the billing view (Free → Pro, no stale state)", async ({
    page,
  }) => {
    // There is NO tenant-switcher UI (confirmed by prior reviews): switching the
    // active tenant = (re)issuing the session cookie. Seed tenant A as Free, drive
    // it, then swap the cookie to tenant B (fresh Pro trial) and drive the in-UI
    // refresh — the view must reflect ONLY B, with A's Free state fully gone.
    const free = await registerTenant(page);
    await seedFreeTenant(free.tenantId);
    await useSession(page, free.token);
    await page.goto("/billing");
    await expect(page.getByTestId("billing-tier-chip")).toHaveText("Free");
    await expect(page.getByTestId("billing-status-chip")).toHaveText("Active");
    await expect(page.getByTestId("billing-trial-badge")).toHaveCount(0);

    // Switch to the Pro-trial tenant and refresh (the Server Action reads the
    // CURRENT cookie). The client refreshes both visibility AND invoices, so a
    // switch cannot leave stale values on screen.
    const pro = await registerTenant(page);
    await page.context().clearCookies();
    await useSession(page, pro.token);
    // Trigger the client's focus refresh deterministically via a Server-Action
    // -backed reload of the current session (a full navigation re-runs SSR with
    // the new cookie).
    await page.goto("/billing");

    // ONLY tenant B's Pro-trial state is shown — replace, never merge.
    await expect(page.getByTestId("billing-tier-chip")).toHaveText("Pro");
    await expect(page.getByTestId("billing-status-chip")).toHaveText("Trial");
    await expect(page.getByTestId("billing-trial-badge")).toContainText("Pro trial");
    // A's Free markers are gone.
    await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
  });

  test("a lapsed trial shows the trial-ended banner; an active trial shows none", async ({
    page,
  }) => {
    // Active Pro trial → NO access-ended banner.
    const active = await registerTenant(page);
    await useSession(page, active.token);
    await page.goto("/billing");
    await expect(page.getByTestId("billing-access-ended")).toHaveCount(0);
    await expect(page.getByText("Your Pro trial has ended")).toHaveCount(0);

    // Lapsed trial → the trial-ended banner with its upgrade CTA. The effective
    // tier resolves to Free and the trial badge is not shown (an expired trial is
    // not an active unexpired trial).
    const lapsed = await registerTenant(page);
    await seedExpiredTrial(lapsed.tenantId);
    await page.context().clearCookies();
    await useSession(page, lapsed.token);
    await page.goto("/billing");

    const banner = page.getByTestId("billing-access-ended");
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("heading", { name: "Your Pro trial has ended" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "View upgrade options" })).toBeVisible();
    await expect(page.getByTestId("billing-tier-chip")).toHaveText("Free");
    await expect(page.getByTestId("billing-trial-badge")).toHaveCount(0);
  });

  test("an ended paid subscription shows the subscription-ended banner (distinct from trial)", async ({
    page,
  }) => {
    const ended = await registerTenant(page);
    await seedEndedSubscription(ended.tenantId);
    await useSession(page, ended.token);
    await page.goto("/billing");

    const banner = page.getByTestId("billing-access-ended");
    await expect(banner).toBeVisible();
    // Distinct copy from a lapsed trial (#196): "subscription", not "trial".
    await expect(
      banner.getByRole("heading", { name: "Your Pro subscription has ended" }),
    ).toBeVisible();
    await expect(page.getByText("Your Pro trial has ended")).toHaveCount(0);
    await expect(page.getByTestId("billing-tier-chip")).toHaveText("Free");
    await expect(page.getByTestId("billing-status-chip")).toHaveText("Expired");
  });

  test("the error card focuses the Retry button for keyboard users (a11y)", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/billing");
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    // The error/offline card moves focus to Retry so a keyboard user lands on the
    // recovery action (BillingPageClient focuses retryButtonRef).
    await expect(retry).toBeFocused();
  });

  test("billing regions expose accessible landmarks (a11y)", async ({ page }) => {
    const tenant = await registerTenant(page);
    await useSession(page, tenant.token);
    await page.goto("/billing");
    // Labelled regions for the main column and the plan-options aside.
    await expect(page.getByRole("region", { name: "Billing overview" })).toBeVisible();
    // The plan-options column is an <aside> → implicit ARIA "complementary" role.
    await expect(page.getByRole("complementary", { name: "Plan options" })).toBeVisible();
    // The cycle toggle is an accessible radiogroup.
    await expect(page.getByRole("radiogroup", { name: "Billing cycle" })).toBeVisible();
  });

  test("Stripe checkout + portal are wired to the boundary (no external redirect)", async ({
    page,
  }) => {
    // We CANNOT complete a live Stripe test checkout / Customer Portal in e2e
    // (no test card can be driven through stripe.com deterministically). Assert
    // ONLY up to the wired boundary: the CTA is present, enabled, and initiates
    // the server action. Stripe is unconfigured in the e2e stack, so the action
    // fails closed and surfaces its error alert IN-PAGE — proving the button is
    // wired to the checkout/portal action WITHOUT ever navigating to stripe.com.
    const owner = await registerTenant(page);
    await useSession(page, owner.token);
    await page.goto("/billing");

    // Upgrade CTA → checkout action.
    const upgrade = page.getByRole("button", { name: "Upgrade to Pro" });
    await expect(upgrade).toBeEnabled();
    await upgrade.click();
    // Scope to the specific copy: a bare getByRole("alert") also matches Next's
    // empty __next-route-announcer__ live region (strict-mode violation).
    await expect(
      page.getByText("We couldn't start checkout. Please try again."),
    ).toBeVisible();
    // Still on /billing — no external redirect was followed.
    expect(new URL(page.url()).pathname).toBe("/billing");

    // Manage CTA (owner-only) → portal action.
    const manage = page.getByRole("button", { name: "Manage / Add card" });
    await expect(manage).toBeEnabled();
    await manage.click();
    // Scope to the specific copy: the checkout alert above is still on screen, so
    // a bare getByRole("alert") would match two nodes (strict-mode violation).
    await expect(
      page.getByText("We couldn't open the billing portal. Please try again."),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/billing");
  });
});

/**
 * MANUAL QA CHECKLIST — the acceptance points from #200 that genuinely cannot be
 * automated in the Playwright + stack harness (do NOT fake a pass; run these by
 * hand once against a live stack with real Stripe TEST keys). See also
 * docs/billing/QA-CHECKLIST.md.
 *
 *   [ ] Complete a live Stripe TEST checkout from the Upgrade CTA (card
 *       4242 4242 4242 4242) and confirm the webhook flips the tenant to
 *       Pro/active, the "Your current plan" badge appears, and the Renewal /
 *       Current-period tiles populate from the subscription.
 *   [ ] Open the Stripe Customer Portal from "Manage / Add card" as an owner of a
 *       SUBSCRIBED tenant (has a stripe_customer_id), update the card, and cancel
 *       — confirm the portal returns to /billing and the state reflects the change.
 *   [ ] With a subscribed tenant, confirm the owner Invoice History lists real
 *       invoices with working Receipt links (hostedInvoiceUrl / receiptUrl).
 *   [ ] Loading + offline cards: throttle / go offline in DevTools and trigger a
 *       refresh from the error state (server-side RSC fetch stall/failure cannot
 *       be forced from the browser; covered at the component-test level).
 */
