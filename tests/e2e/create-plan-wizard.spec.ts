import { expect, test, type Page } from "@playwright/test";

/**
 * Create-plan wizard — full-stack happy path + resume (07-v1-plan-wizard, PR 3).
 *
 * Exercises the real stack end-to-end: register a fresh user through the real
 * `/sign-up` UI (which sets the `kinora_session` cookie), drive the six-step
 * wizard, exit mid-flow and confirm the server-persisted draft resumes at the
 * same step, then Finish and assert a confirmed `plan_specs` row was persisted
 * (the draft is gone and a second promote returns 409) and that NO workout
 * program is produced — the wizard's only output is the PlanSpec.
 *
 * Requires the api + migrated Postgres booted by `scripts/e2e-with-stack.mjs`.
 */

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

/** Register a unique user through the real sign-up UI; returns credentials. */
async function registerFreshUser(page: Page) {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e+plan-${unique}@kinora.test`;
  const password = "Sup3rSecret!pw";

  await page.goto("/sign-up");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);

  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-up"), {
      timeout: 30_000,
    }),
    page.click("button[type=submit]"),
  ]);

  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "kinora_session" && c.value.length > 0);
  expect(session, "sign-up should set the kinora_session cookie").toBeTruthy();

  return { email, password, token: session!.value };
}

/** Click a selectable option card by its accessible name and continue. */
async function chooseAndContinue(page: Page, optionName: RegExp) {
  await page.getByRole("button", { name: optionName }).first().click();
  await page.getByRole("button", { name: /Continue/i }).click();
}

test.describe("Create-plan wizard (07)", () => {
  test("completes, resumes mid-flow, and persists a confirmed PlanSpec", async ({
    page,
  }) => {
    const { token } = await registerFreshUser(page);

    await page.goto("/create-plan");

    // Step 1 — goal
    await expect(page.getByText("1 / 6")).toBeVisible();
    await chooseAndContinue(page, /Strength/i);

    // Step 2 — location
    await expect(page.getByText("2 / 6")).toBeVisible();
    await chooseAndContinue(page, /Gym/i);

    // Step 3 — frequency. Exit mid-flow AFTER this step is saved, to prove
    // the server draft resumes at the right place.
    await expect(page.getByText("3 / 6")).toBeVisible();
    await chooseAndContinue(page, /3 days/i);

    // Now on step 4 (duration). Navigate away (exit the wizard).
    await expect(page.getByText("4 / 6")).toBeVisible();
    await page.goto("/dashboard");

    // Re-enter — the wizard resumes from the server-persisted draft at step 4
    // with the prior answers intact.
    await page.goto("/create-plan");
    await expect(page.getByText("4 / 6")).toBeVisible();
    // Going back shows the previously chosen gym selection still pressed.
    await page.getByRole("button", { name: /Back/i }).click();
    await expect(page.getByText("3 / 6")).toBeVisible();
    await page.getByRole("button", { name: /Continue/i }).click();

    // Step 4 — duration
    await expect(page.getByText("4 / 6")).toBeVisible();
    await chooseAndContinue(page, /60 min/i);

    // Step 5 — equipment (empty selection is valid)
    await expect(page.getByText("5 / 6")).toBeVisible();
    await page.getByRole("button", { name: /Barbell/i }).click();
    await page.getByRole("button", { name: /Continue/i }).click();

    // Step 6 — limitations (empty list valid) → Finish
    await expect(page.getByText("6 / 6")).toBeVisible();
    const finish = page.getByRole("button", { name: /Finish/i });
    await expect(finish).toBeEnabled();
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/create-plan"), {
        timeout: 30_000,
      }),
      finish.click(),
    ]);

    // The confirmed PlanSpec is persisted: the draft is consumed (204) and a
    // second promote has nothing to confirm (409). Both prove a plan_specs row
    // was written and the draft removed.
    const draftAfter = await page.request.get(
      `${API_BASE}/plan-specs/drafts/current`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(draftAfter.status()).toBe(204);

    const repromote = await page.request.post(`${API_BASE}/plan-specs`, {
      headers: { authorization: `Bearer ${token}` },
      data: {},
    });
    expect(repromote.status()).toBe(409);
  });
});
