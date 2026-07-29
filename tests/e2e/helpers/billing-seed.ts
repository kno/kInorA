import { expect, type Page } from "@playwright/test";
// The DB seeding logic lives in apps/api — the ONLY workspace allowed to declare
// a database driver (scripts/deps-guard.mjs). Importing it here keeps the `pg`
// dependency resolved through apps/api and OUT of the repo-root package.json, so
// `pnpm deps-guard` stays green. See apps/api/scripts/e2e-seed.mjs for details.
import {
  closeSeedPool,
  currentPeriod,
  demoteToMember,
  seedAdherencePlan,
  seedEndedSubscription,
  seedExpiredTrial,
  seedFreeTenant,
  seedTenantUsage,
} from "../../../apps/api/scripts/e2e-seed.mjs";

// Re-export the DB seeding helpers so specs import everything from one place.
export {
  closeSeedPool,
  currentPeriod,
  demoteToMember,
  seedAdherencePlan,
  seedEndedSubscription,
  seedExpiredTrial,
  seedFreeTenant,
  seedTenantUsage,
};

/**
 * Billing e2e seeding helpers (issue #200) — the Playwright-facing surface.
 *
 * The actual Postgres writes live in apps/api/scripts/e2e-seed.mjs (the
 * DB-allowed workspace); this module adds the browser/registration pieces that
 * depend on Playwright. A fresh registration is ALWAYS a Pro/`trialing` OWNER,
 * so the seed helpers reshape that tenant BY ID for the states a sign-up cannot
 * reach (Free, lapsed trial, ended subscription, non-owner, consumed usage).
 */

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

/** Web origin the Playwright browser targets (matches playwright.config.ts baseURL). */
export const WEB_ORIGIN = "http://127.0.0.1:3000";

export interface RegisteredTenant {
  token: string;
  tenantId: string;
  userId: string;
  email: string;
}

/**
 * Register a fresh user through the real API and return its opaque session
 * token PLUS the identifiers needed to seed its tenant. The registering user is
 * the tenant OWNER (see AuthService.register → provisionTenantForUser), so the
 * returned tenant renders the owner-only invoice/portal surfaces until demoted.
 */
export async function registerTenant(page: Page): Promise<RegisteredTenant> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e+billing-200-${unique}@kinora.test`;
  const res = await page.request.post(`${API_BASE}/auth/register`, {
    data: { email, password: "Sup3rSecret!pw" },
  });
  expect(res.ok(), "registration should succeed").toBeTruthy();
  const body = (await res.json()) as {
    token: string;
    user: { id: string };
    tenant: { id: string };
  };
  expect(body.token, "register should return a session token").toBeTruthy();
  expect(body.tenant?.id, "register should return the tenant id").toBeTruthy();
  expect(body.user?.id, "register should return the user id").toBeTruthy();
  return { token: body.token, tenantId: body.tenant.id, userId: body.user.id, email };
}

/** Set the browser's session cookie to a given tenant's token. */
export async function useSession(page: Page, token: string): Promise<void> {
  await page.context().addCookies([
    { name: "kinora_session", value: token, url: WEB_ORIGIN },
  ]);
}
