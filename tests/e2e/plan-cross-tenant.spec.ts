import { expect, test, type Page } from "@playwright/test";

/**
 * Cross-tenant draft isolation — real-DB regression proof (07-v1-plan-wizard).
 *
 * Deferred from the PR 2 review (Finding 1): the route unit tests used a mocked
 * DB and could not prove tenant scoping end-to-end. Each `POST /auth/register`
 * provisions a NEW tenant per user, so two freshly-registered users live in
 * DIFFERENT tenants. This test seeds a draft as user A (tenant A) through the
 * real API/stack, then proves user B (tenant B) cannot read or promote it:
 *
 *   - B's `GET /plan-specs/drafts/current` returns 204 (does not see A's draft)
 *   - B's `POST /plan-specs` returns 409 (no draft of B's to promote — it does
 *     NOT act on A's draft)
 *   - A's draft is still intact afterwards (B's actions had no effect on it)
 *
 * Requires the api + migrated Postgres booted by `scripts/e2e-with-stack.mjs`.
 */

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

/** Register a fresh user via the real API and return its session token. */
async function registerViaApi(page: Page): Promise<string> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e+tenant-${unique}@kinora.test`;
  const res = await page.request.post(`${API_BASE}/auth/register`, {
    data: { email, password: "Sup3rSecret!pw" },
  });
  expect(res.ok(), "registration should succeed").toBeTruthy();
  const body = (await res.json()) as { token: string };
  expect(body.token, "register should return a session token").toBeTruthy();
  return body.token;
}

test.describe("Plan draft cross-tenant isolation (07)", () => {
  test("a different tenant cannot read or promote another tenant's draft", async ({
    page,
  }) => {
    const tokenA = await registerViaApi(page);
    const tokenB = await registerViaApi(page);
    expect(tokenA).not.toBe(tokenB);

    // User A (tenant A) seeds a draft via the real API.
    const seed = await page.request.post(`${API_BASE}/plan-specs/drafts`, {
      headers: { authorization: `Bearer ${tokenA}` },
      data: {
        step: 2,
        spec: { goal: "strength", location: "gym" },
      },
    });
    expect(seed.status()).toBe(200);

    // User B (tenant B) cannot SEE A's draft.
    const bSeesDraft = await page.request.get(
      `${API_BASE}/plan-specs/drafts/current`,
      { headers: { authorization: `Bearer ${tokenB}` } },
    );
    expect(bSeesDraft.status()).toBe(204);

    // User B cannot PROMOTE — there is no draft in tenant B, and A's draft must
    // not be reachable. 409 = "no_active_draft" for B.
    const bPromote = await page.request.post(`${API_BASE}/plan-specs`, {
      headers: { authorization: `Bearer ${tokenB}` },
      data: {},
    });
    expect(bPromote.status()).toBe(409);

    // A's draft is still intact — B's actions had no effect on it.
    const aStillHasDraft = await page.request.get(
      `${API_BASE}/plan-specs/drafts/current`,
      { headers: { authorization: `Bearer ${tokenA}` } },
    );
    expect(aStillHasDraft.status()).toBe(200);
    const aDraft = (await aStillHasDraft.json()) as {
      step: number;
      spec: { goal?: string; location?: string };
    };
    expect(aDraft.step).toBe(2);
    expect(aDraft.spec.goal).toBe("strength");
    expect(aDraft.spec.location).toBe("gym");
  });
});
