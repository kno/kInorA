import { eq, isNull } from "drizzle-orm";
import type { Database } from "../client.js";
import { tenantBillingStates, tenants } from "../schema.js";

export const BILLING_TRIAL_DAYS = 30;
export const BILLING_MIGRATION_CUTOFF_MS = 1_784_793_632_233;

export interface BillingStateInsert {
  tenantId: string;
  tier: "free" | "pro";
  status: "active" | "trialing";
  source: "backfill" | "system";
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
}

export interface BillingBackfillResult {
  scannedMissing: number;
  inserted: number;
  skippedExisting: number;
}

type BillingBackfillDb = Pick<Database, "select" | "insert">;

function addDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export function buildTrialBillingState(
  tenantId: string,
  now: Date = new Date(),
): BillingStateInsert {
  return {
    tenantId,
    tier: "pro",
    status: "trialing",
    source: "system",
    trialStartedAt: new Date(now),
    trialEndsAt: addDays(now, BILLING_TRIAL_DAYS),
  };
}

export function buildBackfillBillingState(tenantId: string): BillingStateInsert {
  return {
    tenantId,
    tier: "free",
    status: "active",
    source: "backfill",
    trialStartedAt: null,
    trialEndsAt: null,
  };
}

export function buildMissingBillingState(
  tenantId: string,
  tenantCreatedAt: Date,
): BillingStateInsert {
  return tenantCreatedAt.getTime() >= BILLING_MIGRATION_CUTOFF_MS
    ? buildTrialBillingState(tenantId, tenantCreatedAt)
    : buildBackfillBillingState(tenantId);
}

export async function backfillTenantBillingStates(
  db: BillingBackfillDb,
): Promise<BillingBackfillResult> {
  const missingRows = (await db
    .select({ tenantId: tenants.id, createdAt: tenants.createdAt })
    .from(tenants)
    .leftJoin(tenantBillingStates, eq(tenants.id, tenantBillingStates.tenantId))
    .where(isNull(tenantBillingStates.tenantId))) as Array<{
    tenantId: string | null;
    createdAt: Date;
  }>;

  const missingStates = missingRows.map((row) => {
    if (!row.tenantId) {
      throw new Error("Billing backfill received tenant without id");
    }
    return buildMissingBillingState(row.tenantId, row.createdAt);
  });

  if (missingStates.length === 0) {
    return { scannedMissing: 0, inserted: 0, skippedExisting: 0 };
  }

  const insertedRows = await db
    .insert(tenantBillingStates)
    .values(missingStates)
    .onConflictDoNothing()
    .returning({ tenantId: tenantBillingStates.tenantId });

  return {
    scannedMissing: missingStates.length,
    inserted: insertedRows.length,
    skippedExisting: missingStates.length - insertedRows.length,
  };
}
