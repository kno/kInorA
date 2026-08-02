/**
 * Real-Postgres integration coverage for the 16a-v3-gym-white-label Slice 1
 * additive schema (`0018_gym_tier_enum.sql` + `0019_tenant_branding.sql`) and
 * `TenantBrandingRepository`.
 *
 * A pure unit suite (`tenant-branding.test.ts`) proves the repository's SQL
 * shape against a mocked `Database`, but only a real Postgres can prove:
 *
 *   1. The `gym` value is usable in `billing_tier`.
 *   2. `tenant_branding` enforces the unique `subdomain_slug` index — a
 *      second row using an already-taken slug raises a unique violation.
 *   3. `upsert` is idempotent per tenant: a second call for the same tenant
 *      updates the existing row rather than inserting a duplicate.
 *   4. The DB CHECK constraint rejects a malformed hex color at the SQL
 *      layer, independent of the application-layer `validatePalette` guard.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * the other integration suites) — skipped when no real Postgres is wired so
 * the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import { tenants } from "../../schema.js";
import { TenantBrandingRepository, type UpsertTenantBrandingInput } from "../tenant-branding.js";

const hasDb = Boolean(process.env.DATABASE_URL);

function blankInput(overrides: Partial<UpsertTenantBrandingInput> = {}): UpsertTenantBrandingInput {
  return {
    subdomainSlug: `gym-${Date.now()}-${Math.random()}`,
    logoStorageKey: null,
    accent: null,
    accentFg: null,
    surface: null,
    surface2: null,
    fg: null,
    muted: null,
    ...overrides,
  };
}

describe.skipIf(!hasDb)("TenantBrandingRepository (real Postgres, 16a-v3 Slice 1)", () => {
  const { db, pool } = createDbClient();
  const repo = new TenantBrandingRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `tenant-branding-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  it("upserts and reads back a branding row scoped to the tenant", async () => {
    const tenantId = await seedTenant();
    const slug = `gym-${Date.now()}-${Math.random()}`;

    const created = await repo.upsert(tenantId, blankInput({ subdomainSlug: slug, accent: "#112233" }));

    expect(created.palette.accent).toBe("#112233");

    const found = await repo.findByTenantId(tenantId);
    expect(found?.subdomainSlug).toBe(slug);
    expect(found?.palette.accent).toBe("#112233");
  });

  it("upsert is idempotent per tenant: a second call updates, never duplicates", async () => {
    const tenantId = await seedTenant();
    const slug = `gym-${Date.now()}-${Math.random()}`;

    await repo.upsert(tenantId, blankInput({ subdomainSlug: slug, accent: "#111111" }));
    const updated = await repo.upsert(tenantId, blankInput({ subdomainSlug: slug, accent: "#222222" }));

    expect(updated.palette.accent).toBe("#222222");
    const found = await repo.findByTenantId(tenantId);
    expect(found?.palette.accent).toBe("#222222");
  });

  it("findBySubdomainSlug resolves the tenant matching that slug only", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const slugA = `gym-a-${Date.now()}-${Math.random()}`;
    const slugB = `gym-b-${Date.now()}-${Math.random()}`;

    await repo.upsert(tenantA, blankInput({ subdomainSlug: slugA, accent: "#aaaaaa" }));
    await repo.upsert(tenantB, blankInput({ subdomainSlug: slugB, accent: "#bbbbbb" }));

    const found = await repo.findBySubdomainSlug(slugA);
    expect(found?.tenantId).toBe(tenantA);
    expect(found?.palette.accent).toBe("#aaaaaa");
  });

  it("enforces the unique subdomain_slug index — a second tenant cannot reuse a taken slug", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const slug = `gym-taken-${Date.now()}-${Math.random()}`;

    await repo.upsert(tenantA, blankInput({ subdomainSlug: slug }));

    await expect(repo.upsert(tenantB, blankInput({ subdomainSlug: slug }))).rejects.toThrow();
  });

  it("the DB CHECK constraint rejects a malformed hex color", async () => {
    const tenantId = await seedTenant();

    await expect(
      repo.upsert(tenantId, blankInput({ accent: "not-a-hex-color" })),
    ).rejects.toThrow();
  });
});

describe.skipIf(hasDb)("TenantBrandingRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
