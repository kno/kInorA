import { expect, test } from "@playwright/test";
import {
  closeSeedPool,
  registerTenant,
  seedAdherencePlan,
  useSession,
} from "./helpers/billing-seed";

/**
 * Adherence → adaptation banner end-to-end coverage (issue #246).
 *
 * The 14a adaptation-adherence flow (PRs #235-#243) was proven only in PIECES
 * (domain unit tests for `computeAdherenceAdaptation`, an API route test for
 * `POST /plan-specs/:id/adapt`, and a `DashboardCoachCard` component test with
 * mocked props) — never as ONE live session against the real stack. This spec
 * closes that gap by driving `/dashboard` through the real Next.js app +
 * Fastify API + migrated Postgres booted by `scripts/e2e-with-stack.mjs`.
 *
 * WHAT IS COVERED (deterministic against this harness):
 *   1. A tenant whose completed-vs-planned adherence over the last 4 weeks is
 *      `< 70%` sees the reduce-frequency suggestion on the dashboard, including
 *      the from→to days copy.
 *   2. ACCEPT triggers the adapt/regenerate flow. The adapt handler is a Next
 *      SERVER ACTION (`adaptPlanAction`), so its `POST /plan-specs/:id/adapt`
 *      call to the API runs server-to-server and is invisible to the browser —
 *      we therefore assert the flow UP TO the "generating" transition via the
 *      UI: on a successful 202 `{ status: "generating" }` the card is REPLACED
 *      by the regenerating notice ("Adjusting your plan…") and the accept
 *      button is gone. The e2e stack has NO LLM key, so the async regeneration
 *      can never complete — we intentionally do NOT wait for a finished plan.
 *   3. A tenant at healthy adherence (`>= 70%`) does NOT see the banner.
 *
 * SEEDING (see helpers/billing-seed.ts → apps/api/scripts/e2e-seed.mjs):
 * `seedAdherencePlan` writes, for a freshly-registered tenant/user, a confirmed
 * `plan_specs` row + a `ready` `workout_plans` row (whose `program_json`
 * .weeklySessions.length = `daysPerWeek`, `created_at` 35 days ago so the
 * signal is not suppressed as `insufficient_data`) + N `completed`
 * `workout_sessions` inside the rolling 4-week window. Adherence is
 * `completed / (daysPerWeek * 4)`.
 *
 * Default locale is English (same assumption as billing-visibility.spec.ts).
 * Requires the stack + `DATABASE_URL` injected by scripts/e2e-with-stack.mjs.
 */

test.describe("Adherence adaptation banner (#246)", () => {
  test.afterAll(async () => {
    await closeSeedPool();
  });

  test("a tenant under 70% adherence sees the reduce-frequency suggestion and ACCEPT transitions to generating", async ({
    page,
  }) => {
    const tenant = await registerTenant(page);
    // daysPerWeek 4 → plannedInWindow = 4 × 4 = 16; 3 completed = 18.75% < 70%
    // → adaptation level "low" + reduce_frequency (fromDays 4 → toDays 3).
    await seedAdherencePlan({
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      daysPerWeek: 4,
      completedSessions: 3,
    });
    await useSession(page, tenant.token);

    await page.goto("/dashboard");

    // The reduce-frequency suggestion, with the from→to days interpolated
    // (i18n namespace "adaptation": title / suggestion / accept).
    await expect(page.getByText("Fancy a lighter week?")).toBeVisible();
    await expect(
      page.getByText("Want to try 3 days per week instead of 4?"),
    ).toBeVisible();

    const accept = page.getByRole("button", { name: "Try 3 days" });
    await expect(accept).toBeEnabled();

    // ACCEPT → server action POSTs {} to /plan-specs/:id/adapt → 202
    // { status: "generating" }. On success the card is REPLACED by the
    // regenerating notice and the accept button is removed — that DOM
    // transition is the browser-observable proxy for the 202 (the POST itself
    // is server-side, so it never appears in the browser's network log).
    await accept.click();

    await expect(page.getByText("Adjusting your plan…")).toBeVisible();
    // Card replaced → the accept button is gone (distinguishes the terminal
    // "regenerating" state from the transient "submitting" state, which keeps
    // the disabled button mounted).
    await expect(
      page.getByRole("button", { name: "Try 3 days" }),
    ).toHaveCount(0);
    // The action did NOT fail: no error / quota / up-to-date copy surfaced.
    await expect(
      page.getByText("We couldn't adjust your plan", { exact: false }),
    ).toHaveCount(0);
  });

  test("a tenant at healthy adherence (>= 70%) does NOT see the reduce-frequency banner", async ({
    page,
  }) => {
    const tenant = await registerTenant(page);
    // 15 completed of 16 planned = 93.75% >= 70% → adaptation level "ok";
    // the reduce-frequency banner must not render (the static coach card may).
    await seedAdherencePlan({
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      daysPerWeek: 4,
      completedSessions: 15,
    });
    await useSession(page, tenant.token);

    await page.goto("/dashboard");

    await expect(page.getByText("Fancy a lighter week?")).toHaveCount(0);
    await expect(
      page.getByText("Want to try 3 days per week instead of 4?"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Try 3 days" }),
    ).toHaveCount(0);
  });
});
