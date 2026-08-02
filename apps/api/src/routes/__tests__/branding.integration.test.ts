/**
 * Real-Postgres integration coverage for gym branding CRUD + public
 * read-by-slug (16a-v3-gym-white-label, Slice 3, tasks 3.6/3.7).
 *
 * Exercises the ACTUAL `brandingRoutes` + `publicBrandingRoutes` plugins wired
 * to a real `TenantBrandingRepository` against Postgres — proving, with two
 * REAL seeded gym tenants (not a mocked repo), that:
 *   1. a gym A owner's write can only ever touch gym A's own row — there is
 *      no request field through which gym B's tenantId could be targeted;
 *   2. a gym A member's authenticated read never returns gym B's branding;
 *   3. the public read-by-slug endpoint returns only the requested tenant's
 *      public fields and 404s an unknown slug;
 *   4. a duplicate `subdomainSlug` across two tenants surfaces as a real 409
 *      through the route layer (the unique index, Slice 1), never a 500.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * the other integration suites) — skipped when no real Postgres is wired so
 * the default `vitest run` stays hermetic.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createDbClient } from "../../db/client.js";
import { tenants, tenantBillingStates, memberships, users } from "../../db/schema.js";
import { authPlugin } from "../../auth/plugin.js";
import { brandingRoutes } from "../branding.js";
import { publicBrandingRoutes } from "../public-branding.js";
import { TenantBrandingRepository } from "../../db/repositories/tenant-branding.js";
import { BillingStateReaderRepository } from "../../db/repositories/billing-quota.js";
import { createAuthMockDb, buildSessionRow, buildActiveMembershipRow, VALID_TOKEN } from "../../test-support/auth-mocks.js";

const hasDb = Boolean(process.env.DATABASE_URL);

const PALETTE_A = {
  accent: "#112233",
  accentFg: "#ffffff",
  surface: "#000000",
  surface2: "#111111",
  fg: "#eeeeee",
  muted: "#999999",
};

function fakeStorage() {
  return {
    put: async () => ({ url: "/media/branding/unused" }),
    get: async () => null,
    delete: async () => {},
  };
}

describe.skipIf(!hasDb)("Gym branding CRUD + public read (real Postgres, 16a-v3 Slice 3)", () => {
  const { db, pool } = createDbClient();
  const brandingRepo = new TenantBrandingRepository(db);
  const entitlementReader = new BillingStateReaderRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  let app: FastifyInstance | undefined;
  let publicApp: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    await publicApp?.close();
    publicApp = undefined;
  });

  async function seedGymTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `gym-branding-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    const tenantId = tenant!.id;
    await db.insert(tenantBillingStates).values({ tenantId, tier: "gym", status: "active", source: "system" });
    return tenantId;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `gym-branding-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return user!.id;
  }

  async function seedActiveOwnerMembership(tenantId: string, userId: string): Promise<void> {
    await db.insert(memberships).values({ tenantId, userId, role: "owner", status: "active" });
  }

  async function buildGatedApp(tenantId: string, userId: string): Promise<FastifyInstance> {
    const built = Fastify();
    const authDb = createAuthMockDb({
      sessionRows: [buildSessionRow({ tenantId, userId })],
      membershipRows: [buildActiveMembershipRow({ tenantId, userId, role: "owner" })],
    }).db;
    await built.register(authPlugin, { db: authDb });
    await built.register(brandingRoutes, { repo: brandingRepo, storage: fakeStorage(), entitlementReader });
    return built;
  }

  async function buildPublicApp(): Promise<FastifyInstance> {
    const built = Fastify();
    await built.register(publicBrandingRoutes, { repo: brandingRepo });
    return built;
  }

  it("gym A owner writes branding via PUT /branding; gym B's row (created independently) stays untouched (task 3.6)", async () => {
    const tenantA = await seedGymTenant();
    const userA = await seedUser();
    await seedActiveOwnerMembership(tenantA, userA);
    const slugA = `gym-a-${Date.now()}`;

    const tenantB = await seedGymTenant();
    const userB = await seedUser();
    await seedActiveOwnerMembership(tenantB, userB);
    const slugB = `gym-b-${Date.now()}`;
    await brandingRepo.upsert(tenantB, {
      subdomainSlug: slugB,
      logoStorageKey: null,
      accent: "#ff0000",
      accentFg: null,
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    });

    app = await buildGatedApp(tenantA, userA);
    const res = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({ subdomainSlug: slugA, palette: PALETTE_A }),
    });

    expect(res.statusCode).toBe(200);
    const bodyA = res.json() as { tenantId: string };
    expect(bodyA.tenantId).toBe(tenantA);

    // Gym B's branding row is completely unaffected by gym A's write.
    const rowB = await brandingRepo.findByTenantId(tenantB);
    expect(rowB?.subdomainSlug).toBe(slugB);
    expect(rowB?.palette.accent).toBe("#ff0000");
  });

  it("gym A member's authenticated read never returns gym B's branding (task 3.7)", async () => {
    const tenantA = await seedGymTenant();
    const userA = await seedUser();
    await seedActiveOwnerMembership(tenantA, userA);
    const slugA = `gym-a-read-${Date.now()}`;
    await brandingRepo.upsert(tenantA, {
      subdomainSlug: slugA,
      logoStorageKey: null,
      ...{ accent: "#aaaaaa", accentFg: null, surface: null, surface2: null, fg: null, muted: null },
    });

    const tenantB = await seedGymTenant();
    const slugB = `gym-b-read-${Date.now()}`;
    await brandingRepo.upsert(tenantB, {
      subdomainSlug: slugB,
      logoStorageKey: null,
      accent: "#bbbbbb",
      accentFg: null,
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    });

    app = await buildGatedApp(tenantA, userA);
    const res = await app.inject({
      method: "GET",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { tenantId: string; subdomainSlug: string; palette: { accent: string } };
    expect(body.tenantId).toBe(tenantA);
    expect(body.subdomainSlug).toBe(slugA);
    expect(body.palette.accent).toBe("#aaaaaa");
  });

  it("duplicate subdomainSlug across two tenants surfaces as a real 409 (not 500) through the route", async () => {
    const tenantA = await seedGymTenant();
    const userA = await seedUser();
    await seedActiveOwnerMembership(tenantA, userA);
    const takenSlug = `gym-taken-${Date.now()}`;
    await brandingRepo.upsert(tenantA, {
      subdomainSlug: takenSlug,
      logoStorageKey: null,
      accent: null,
      accentFg: null,
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    });

    const tenantB = await seedGymTenant();
    const userB = await seedUser();
    await seedActiveOwnerMembership(tenantB, userB);

    app = await buildGatedApp(tenantB, userB);
    const res = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({ subdomainSlug: takenSlug, palette: PALETTE_A }),
    });

    expect(res.statusCode).toBe(409);
  });

  it("public read-by-slug returns only the matching tenant's public fields; unknown slug 404s (task 3.9/3.10)", async () => {
    const tenantA = await seedGymTenant();
    const slugA = `gym-public-${Date.now()}`;
    await brandingRepo.upsert(tenantA, {
      subdomainSlug: slugA,
      logoStorageKey: null,
      accent: "#cccccc",
      accentFg: null,
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    });

    publicApp = await buildPublicApp();

    const known = await publicApp.inject({ method: "GET", url: `/public/branding/by-slug/${slugA}` });
    expect(known.statusCode).toBe(200);
    const body = known.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["logoUrl", "palette"]);
    expect((body.palette as { accent: string }).accent).toBe("#cccccc");

    const unknown = await publicApp.inject({ method: "GET", url: "/public/branding/by-slug/never-existed" });
    expect(unknown.statusCode).toBe(404);
  });
});

describe.skipIf(hasDb)("Gym branding CRUD + public read (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
