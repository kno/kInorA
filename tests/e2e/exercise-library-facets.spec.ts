import { expect, test, type Page } from "@playwright/test";

/**
 * Exercise-library multi-select facets — soft-navigation regression proof
 * (#345).
 *
 * This HAS to be an end-to-end test. The bug it guards was not in any value
 * this repo computes: `handleSubmit` already pushed the right URL, `page.tsx`
 * already rendered the right results for that URL, and the RSC payload that
 * came back over the wire already contained them. Next's client router simply
 * declined to commit that payload, because it keys a page's cached segment on
 * `Object.fromEntries(new URLSearchParams(search))` — last occurrence wins —
 * so `?bodyPart=chest&bodyPart=cardio` was indistinguishable from
 * `?bodyPart=cardio`. Only a real browser driving a real soft navigation can
 * see the difference between "the URL changed" and "the page changed".
 *
 * The assertion is therefore deliberately about the RENDERED result count,
 * never about the pushed URL: a unit test on the URL passed happily
 * throughout the entire lifetime of the bug.
 *
 * The catalog is STATIC reference data shipped inside
 * `@kinora/exercise-catalog` (not Postgres, not tenant-scoped), so these
 * counts are fixed for a given catalog and need no seeding — a fresh
 * registration can read the whole library.
 *
 * Requires the api + web stack booted by `scripts/e2e-with-stack.mjs`.
 */

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

/** Catalog totals for the filters this spec drives (static reference data). */
const CARDIO_ONLY = "29";
const CHEST_ONLY = "163";
const CHEST_OR_CARDIO = "192";

/** Register a fresh user via the real API and put its session in the browser. */
async function signIn(page: Page): Promise<void> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const res = await page.request.post(`${API_BASE}/auth/register`, {
    data: { email: `e2e+facets-345-${unique}@kinora.test`, password: "Sup3rSecret!pw" },
  });
  expect(res.ok(), "registration should succeed").toBeTruthy();
  const { token } = (await res.json()) as { token: string };
  // Scoped to the origin the browser is actually on, which the caller has
  // already navigated to — the suite's baseURL is not importable here.
  await page.context().addCookies([
    { name: "kinora_session", value: token, url: new URL(page.url()).origin },
  ]);
}

/** The result count the library is currently SHOWING, as a bare number. */
async function shownTotal(page: Page): Promise<string> {
  const text = await page.getByTestId("exercise-library-count").textContent();
  return (text ?? "").replace(/[^\d]/g, "");
}

/** Click one facet chip by its checkbox value (the input is visually hidden). */
function chip(page: Page, field: string, value: string) {
  return page.locator(`label.kin-ex-chip:has(input[name="${field}"][value="${value}"])`);
}

test.describe("Exercise library multi-select facets (#345)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/exercises");
    await signIn(page);
  });

  test("adding a SECOND value to a facet group re-renders the results", async ({ page }) => {
    await page.goto("/exercises?bodyPart=cardio");
    expect(await shownTotal(page)).toBe(CARDIO_ONLY);

    // Soft navigation: the form auto-submits and `router.push`es. The page must
    // NOT stay on the previous result set.
    await chip(page, "bodyPart", "chest").click();

    await expect
      .poll(() => shownTotal(page), { timeout: 10_000 })
      .toBe(CHEST_OR_CARDIO);
    await expect(page.locator('input[name="bodyPart"]:checked')).toHaveCount(2);
  });

  test("removing a value that is not the last one re-renders the results", async ({ page }) => {
    await page.goto("/exercises?bodyPart=cardio,chest");
    expect(await shownTotal(page)).toBe(CHEST_OR_CARDIO);

    await chip(page, "bodyPart", "cardio").click();

    await expect.poll(() => shownTotal(page), { timeout: 10_000 }).toBe(CHEST_ONLY);
  });

  test("a soft navigation matches what a direct load of the same URL renders", async ({
    page,
  }) => {
    await page.goto("/exercises?equipment=barbell");
    const before = await shownTotal(page);

    await chip(page, "equipment", "dumbbell").click();
    await expect.poll(() => shownTotal(page), { timeout: 10_000 }).not.toBe(before);

    const softUrl = page.url();
    const softTotal = await shownTotal(page);

    await page.goto(softUrl);
    expect(
      await shownTotal(page),
      "soft navigation and direct load of the same URL must agree"
    ).toBe(softTotal);
  });

  test("a repeated-key URL (what a no-JS submit produces) is read and canonicalised", async ({
    page,
  }) => {
    await page.goto("/exercises?bodyPart=chest&bodyPart=cardio");

    expect(await shownTotal(page)).toBe(CHEST_OR_CARDIO);
    expect(new URL(page.url()).searchParams.getAll("bodyPart")).toEqual(["chest,cardio"]);
    await expect(page.locator('input[name="bodyPart"]:checked')).toHaveCount(2);
  });

  test("the no-JS Apply path still filters, without any client JavaScript", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/exercises");
    await signIn(page);

    await page.goto("/exercises?bodyPart=cardio");
    expect(await shownTotal(page)).toBe(CARDIO_ONLY);

    await chip(page, "bodyPart", "chest").click();
    await Promise.all([
      page.waitForNavigation(),
      page.locator("button.kin-ex-apply").click(),
    ]);

    expect(await shownTotal(page)).toBe(CHEST_OR_CARDIO);
    await expect(page.locator('input[name="bodyPart"]:checked')).toHaveCount(2);
    await context.close();
  });
});
