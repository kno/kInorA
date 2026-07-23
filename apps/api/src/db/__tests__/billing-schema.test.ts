import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";
import {
  billingAuditActionEnum,
  billingDecisionEnum,
  billingFeatureEnum,
  billingSourceEnum,
  billingStatusEnum,
  billingTierEnum,
  billingAuditEvents,
  billingUsageLedger,
  memberQuotaAllocations,
  memberQuotaCounters,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
} from "../schema.js";
import { BILLING_MIGRATION_CUTOFF_MS } from "../repositories/billing-backfill.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0011_billing_plans_tiers.sql", import.meta.url)),
  "utf8",
);

const migrationJournal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../drizzle/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ tag: string; when: number }> };

describe("billing schema shape", () => {
  it("defines the billing enums required by 11a", () => {
    expect(billingTierEnum.enumValues).toEqual(["free", "pro"]);
    expect(billingStatusEnum.enumValues).toEqual([
      "active",
      "trialing",
      "expired",
      "overridden",
    ]);
    expect(billingSourceEnum.enumValues).toEqual([
      "system",
      "backfill",
      "admin_override",
    ]);
    expect(billingFeatureEnum.enumValues).toEqual([
      "plan_generation",
      "plan_regeneration",
      "memory_write",
      "memory_retrieval",
    ]);
    expect(billingDecisionEnum.enumValues).toEqual(["allowed", "denied"]);
    expect(billingAuditActionEnum.enumValues).toEqual([
      "member_allocation_set",
      "admin_override_created",
      "admin_override_expired",
    ]);
  });

  it("defines the tenant billing tables", () => {
    expect(isTable(tenantBillingStates)).toBe(true);
    expect(isTable(tenantBillingOverrides)).toBe(true);
    expect(isTable(tenantQuotaCounters)).toBe(true);
  });

  it("tenantBillingStates stores one authoritative tenant-owned state", () => {
    const cols = getTableColumns(tenantBillingStates);
    expect(cols.tenantId?.columnType).toBe("PgUUID");
    expect(cols.tier?.columnType).toBe("PgEnumColumn");
    expect(cols.status?.columnType).toBe("PgEnumColumn");
    expect(cols.source?.columnType).toBe("PgEnumColumn");
    expect(cols.trialStartedAt).toBeDefined();
    expect(cols.trialEndsAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it("defines member-scoped quota tables keyed by tenant and user", () => {
    expect(isTable(memberQuotaAllocations)).toBe(true);
    expect(isTable(memberQuotaCounters)).toBe(true);

    const allocationCols = getTableColumns(memberQuotaAllocations);
    expect(allocationCols.tenantId?.columnType).toBe("PgUUID");
    expect(allocationCols.userId?.columnType).toBe("PgUUID");
    expect(allocationCols.feature?.columnType).toBe("PgEnumColumn");
    expect(allocationCols.period?.columnType).toBe("PgText");
    expect(allocationCols.limit?.columnType).toBe("PgInteger");
    expect(allocationCols.updatedByUserId?.columnType).toBe("PgUUID");

    const counterCols = getTableColumns(memberQuotaCounters);
    expect(counterCols.tenantId?.columnType).toBe("PgUUID");
    expect(counterCols.userId?.columnType).toBe("PgUUID");
    expect(counterCols.feature?.columnType).toBe("PgEnumColumn");
    expect(counterCols.period?.columnType).toBe("PgText");
    expect(counterCols.used?.columnType).toBe("PgInteger");
    expect(counterCols.limit?.columnType).toBe("PgInteger");
  });

  it("defines ledger and audit persistence for later atomic consumption", () => {
    expect(isTable(billingUsageLedger)).toBe(true);
    expect(isTable(billingAuditEvents)).toBe(true);

    const ledgerCols = getTableColumns(billingUsageLedger);
    expect(ledgerCols.tenantId?.columnType).toBe("PgUUID");
    expect(ledgerCols.userId?.columnType).toBe("PgUUID");
    expect(ledgerCols.operationKey?.columnType).toBe("PgText");
    expect(ledgerCols.decision?.columnType).toBe("PgEnumColumn");
    expect(ledgerCols.reason?.columnType).toBe("PgText");
    // #174 FIX A: recorded at consume time so a compensating void reverses
    // exactly what THIS operation incremented, never current allocation state.
    expect(ledgerCols.memberCounterCredited?.columnType).toBe("PgBoolean");

    const auditCols = getTableColumns(billingAuditEvents);
    expect(auditCols.id?.columnType).toBe("PgUUID");
    expect(auditCols.tenantId?.columnType).toBe("PgUUID");
    expect(auditCols.actorUserId?.columnType).toBe("PgUUID");
    expect(auditCols.subjectUserId?.columnType).toBe("PgUUID");
    expect(auditCols.action?.columnType).toBe("PgEnumColumn");
    expect(auditCols.metadata).toBeDefined();
  });
});

describe("billing migration", () => {
  it("keeps journal timestamps strictly increasing and non-future", () => {
    const now = Date.now();

    migrationJournal.entries.forEach((entry, index) => {
      expect(entry.when, `${entry.tag} must not be future-dated`).toBeLessThanOrEqual(now);

      if (index > 0) {
        expect(entry.when, `${entry.tag} must follow the previous migration`).toBeGreaterThan(
          migrationJournal.entries[index - 1]!.when,
        );
      }
    });
    // Pinned to the migration that introduced the 11a billing tables — NOT
    // `.at(-1)`, so a later additive migration (e.g. #174's
    // `member_counter_credited` column) never breaks this assertion.
    const billingMigrationEntry = migrationJournal.entries.find(
      (entry) => entry.tag === "0011_billing_plans_tiers",
    );
    expect(billingMigrationEntry?.when).toBe(BILLING_MIGRATION_CUTOFF_MS);
  });

  it("creates the additive 11a billing tables and enums", () => {
    expect(migrationSql).toContain('CREATE TYPE "public"."billing_tier" AS ENUM');
    expect(migrationSql).toContain('CREATE TYPE "public"."billing_status" AS ENUM');
    expect(migrationSql).toContain('CREATE TABLE "tenant_billing_states"');
    expect(migrationSql).toContain('CREATE TABLE "tenant_billing_overrides"');
    expect(migrationSql).toContain('CREATE TABLE "tenant_quota_counters"');
    expect(migrationSql).toContain('CREATE TABLE "member_quota_allocations"');
    expect(migrationSql).toContain('CREATE TABLE "member_quota_counters"');
    expect(migrationSql).toContain('CREATE TABLE "billing_usage_ledger"');
    expect(migrationSql).toContain('CREATE TABLE "billing_audit_events"');
  });

  it("enforces membership ownership, uniqueness, non-negative checks, and idempotency", () => {
    expect(migrationSql).toContain(
      'ALTER TABLE "member_quota_allocations" ADD CONSTRAINT "member_quota_allocations_tenant_user_memberships_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE "member_quota_counters" ADD CONSTRAINT "member_quota_counters_tenant_user_memberships_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE "billing_usage_ledger" ADD CONSTRAINT "billing_usage_ledger_tenant_user_memberships_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_tenant_actor_memberships_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade',
    );
    expect(migrationSql).toContain('"limit" >= 0');
    expect(migrationSql).toContain('"used" >= 0');
    expect(migrationSql).toContain('"used" <= "tenant_quota_counters"."limit"');
    expect(migrationSql).toContain('"ends_at" > "tenant_billing_overrides"."starts_at"');
    expect(migrationSql).toContain('billing_usage_ledger_operation_unique');
    expect(migrationSql).toContain('member_quota_allocations_scope_unique');
    expect(migrationSql).toContain('member_quota_counters_scope_unique');
    expect(migrationSql).toContain('tenant_quota_counters_scope_unique');
  });

  it("idempotently backfills every tenant present when migration 0011 is applied", () => {
    expect(migrationSql).toContain(
      'INSERT INTO "tenant_billing_states" ("tenant_id", "tier", "status", "source")',
    );
    expect(migrationSql).toContain(
      `SELECT "id", 'free', 'active', 'backfill' FROM "tenants"`,
    );
    expect(migrationSql).toContain('ON CONFLICT ("tenant_id") DO NOTHING');
  });

  it("adds read indexes and stays rollback-safe by avoiding destructive DDL", () => {
    expect(migrationSql).toContain('tenant_billing_overrides_active_window_idx');
    expect(migrationSql).toContain('tenant_quota_counters_period_idx');
    expect(migrationSql).toContain('member_quota_counters_period_idx');
    expect(migrationSql).toContain('billing_usage_ledger_period_idx');
    expect(migrationSql).not.toContain('DROP TABLE');
    expect(migrationSql).not.toContain('ALTER TABLE "memberships" DROP');
  });
});
