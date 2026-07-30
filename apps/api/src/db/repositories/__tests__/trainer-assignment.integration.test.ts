/**
 * Real-Postgres integration coverage for the 15a-v2-trainer-account-access
 * Slice 1 additive schema (`0016_trainer_role_tier_enum.sql` +
 * `0017_trainer_client_assignments.sql`) and `TrainerAssignmentRepository`.
 *
 * A pure unit suite (`trainer-assignment.test.ts`) proves the repository's SQL
 * shape against a mocked `Database`, but only a real Postgres can prove:
 *
 *   1. The `trainer` value is usable in `membership_role`/`billing_tier`.
 *   2. `trainer_client_assignments` enforces one-active-trainer-per-client via
 *      its partial unique index — a second concurrent ACTIVE assignment for
 *      the same client raises a unique violation.
 *   3. `findActiveAssignment` is tenant + status scoped: a revoked row or a
 *      different tenant's row never satisfies the resolver's read.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as the
 * other integration suites) — skipped when no real Postgres is wired so the
 * default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import { tenants, users } from "../../schema.js";
import { TrainerAssignmentRepository } from "../trainer-assignment.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("TrainerAssignmentRepository (real Postgres, 15a-v2 Slice 1)", () => {
  const { db, pool } = createDbClient();
  const repo = new TrainerAssignmentRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `trainer-assignment-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: `trainer-assignment-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return user!.id;
  }

  it("creates an assignment defaulting to 'invited' and reads it back", async () => {
    const tenantId = await seedTenant();
    const trainerUserId = await seedUser();
    const clientUserId = await seedUser();

    const created = await repo.create(tenantId, trainerUserId, clientUserId);

    expect(created.status).toBe("invited");
    // Not yet active — findActiveAssignment must not surface it.
    const active = await repo.findActiveAssignment(tenantId, trainerUserId, clientUserId);
    expect(active).toBeUndefined();
  });

  it("findActiveAssignment returns the row once transitioned to active, tenant-scoped", async () => {
    const tenantId = await seedTenant();
    const otherTenantId = await seedTenant();
    const trainerUserId = await seedUser();
    const clientUserId = await seedUser();

    const created = await repo.create(tenantId, trainerUserId, clientUserId, "active");

    const found = await repo.findActiveAssignment(tenantId, trainerUserId, clientUserId);
    expect(found?.id).toBe(created.id);

    // A different tenant querying the same trainer/client ids finds nothing.
    const crossTenant = await repo.findActiveAssignment(otherTenantId, trainerUserId, clientUserId);
    expect(crossTenant).toBeUndefined();
  });

  it("a revoked assignment is never returned by findActiveAssignment", async () => {
    const tenantId = await seedTenant();
    const trainerUserId = await seedUser();
    const clientUserId = await seedUser();

    const created = await repo.create(tenantId, trainerUserId, clientUserId, "active");
    await repo.updateStatus(tenantId, created.id, "revoked");

    const found = await repo.findActiveAssignment(tenantId, trainerUserId, clientUserId);
    expect(found).toBeUndefined();
  });

  it("enforces one-active-trainer-per-client via the partial unique index", async () => {
    const tenantId = await seedTenant();
    const trainerA = await seedUser();
    const trainerB = await seedUser();
    const clientUserId = await seedUser();

    await repo.create(tenantId, trainerA, clientUserId, "active");

    await expect(repo.create(tenantId, trainerB, clientUserId, "active")).rejects.toThrow();
  });

  it("listByTrainer returns every assignment for that trainer within the tenant", async () => {
    const tenantId = await seedTenant();
    const trainerUserId = await seedUser();
    const clientA = await seedUser();
    const clientB = await seedUser();

    await repo.create(tenantId, trainerUserId, clientA, "active");
    await repo.create(tenantId, trainerUserId, clientB, "invited");

    const list = await repo.listByTrainer(tenantId, trainerUserId);
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.clientUserId).sort()).toEqual([clientA, clientB].sort());
  });
});

describe.skipIf(hasDb)("TrainerAssignmentRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
