import { describe, expect, it, vi } from "vitest";
import {
  backfillTenantBillingStates,
  BILLING_MIGRATION_CUTOFF_MS,
  buildBackfillBillingState,
  buildMissingBillingState,
  buildTrialBillingState,
} from "../billing-backfill.js";
import { tenantBillingStates } from "../../schema.js";

describe("buildTrialBillingState", () => {
  it("starts a 30-day Pro trial exactly at tenant creation time", () => {
    const now = new Date("2026-07-23T10:00:00.000Z");

    const row = buildTrialBillingState("tenant-1", now);

    expect(row).toMatchObject({
      tenantId: "tenant-1",
      tier: "pro",
      status: "trialing",
      source: "system",
      trialStartedAt: now,
      trialEndsAt: new Date("2026-08-22T10:00:00.000Z"),
    });
  });

  it("treats the exact expiry boundary as T + 30 days without rounding", () => {
    const now = new Date("2026-01-31T23:59:59.000Z");

    const row = buildTrialBillingState("tenant-2", now);

    expect(row.trialEndsAt.toISOString()).toBe("2026-03-02T23:59:59.000Z");
  });
});

describe("buildBackfillBillingState", () => {
  it("creates a Free active backfill row without retroactive trial dates", () => {
    expect(buildBackfillBillingState("tenant-3")).toMatchObject({
      tenantId: "tenant-3",
      tier: "free",
      status: "active",
      source: "backfill",
      trialStartedAt: null,
      trialEndsAt: null,
    });
  });
});

describe("buildMissingBillingState", () => {
  it("keeps a legacy pre-migration tenant Free", () => {
    expect(buildMissingBillingState("legacy", new Date(BILLING_MIGRATION_CUTOFF_MS - 1))).toEqual(
      buildBackfillBillingState("legacy"),
    );
  });

  it("recovers a rollback-window tenant with a trial anchored to tenant creation", () => {
    const createdAt = new Date(BILLING_MIGRATION_CUTOFF_MS);

    expect(buildMissingBillingState("new", createdAt)).toEqual(
      buildTrialBillingState("new", createdAt),
    );
  });
});

function createDb(
  missingTenants: Array<{ tenantId: string | null; createdAt: Date }>,
  insertedTenantIds: string[] = [],
) {
  const where = vi.fn().mockResolvedValue(missingTenants);
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ leftJoin });
  const select = vi.fn().mockReturnValue({ from });

  const returning = vi.fn().mockResolvedValue(insertedTenantIds.map((tenantId) => ({ tenantId })));
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockImplementation((table: object) => {
    if (table !== tenantBillingStates) {
      throw new Error(`Unexpected insert table: ${String(table)}`);
    }
    return { values };
  });

  return { db: { select, insert } as never, insert, values, onConflictDoNothing, returning };
}

describe("backfillTenantBillingStates", () => {
  it("backfills only tenants missing a billing row and preserves existing memberships/state", async () => {
    const legacy = new Date("2026-07-22T00:00:00.000Z");
    const rollbackWindow = new Date("2026-07-24T00:00:00.000Z");
    const { db, insert, values } = createDb(
      [
        { tenantId: "tenant-a", createdAt: legacy },
        { tenantId: "tenant-b", createdAt: rollbackWindow },
      ],
      ["tenant-a", "tenant-b"],
    );

    const result = await backfillTenantBillingStates(db);

    expect(result).toEqual({ scannedMissing: 2, inserted: 2, skippedExisting: 0 });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      buildBackfillBillingState("tenant-a"),
      buildTrialBillingState("tenant-b", rollbackWindow),
    ]);
  });

  it("is idempotent on rerun — no missing tenants means no insert", async () => {
    const { db, insert } = createDb([]);

    const result = await backfillTenantBillingStates(db);

    expect(result).toEqual({ scannedMissing: 0, inserted: 0, skippedExisting: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("tolerates a concurrent rerun by relying on onConflictDoNothing for inserts that already landed", async () => {
    const { db } = createDb(
      ["tenant-a", "tenant-b"].map((tenantId) => ({
        tenantId,
        createdAt: new Date("2026-07-22T00:00:00.000Z"),
      })),
      ["tenant-a"],
    );

    const result = await backfillTenantBillingStates(db);

    expect(result).toEqual({ scannedMissing: 2, inserted: 1, skippedExisting: 1 });
  });

  it("fails closed when the backfill scan returns an invalid tenant id", async () => {
    const { db, insert } = createDb([
      { tenantId: null, createdAt: new Date("2026-07-22T00:00:00.000Z") },
    ]);

    await expect(backfillTenantBillingStates(db)).rejects.toThrow(
      /billing backfill received tenant without id/i,
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
