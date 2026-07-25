import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";
import {
  billingCycleEnum,
  billingSourceEnum,
  stripeProcessedEvents,
  tenantBillingStates,
} from "../schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0012_stripe_billing.sql", import.meta.url)),
  "utf8",
);

const migrationJournal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../drizzle/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("stripe billing schema shape (11b Slice 1)", () => {
  it("adds the stripe metadata columns to tenant_billing_states (additive)", () => {
    const cols = getTableColumns(tenantBillingStates);
    // Pre-existing 11a columns stay intact.
    expect(cols.tier?.columnType).toBe("PgEnumColumn");
    expect(cols.status?.columnType).toBe("PgEnumColumn");
    expect(cols.source?.columnType).toBe("PgEnumColumn");
    // New additive stripe metadata columns.
    expect(cols.stripeCustomerId?.columnType).toBe("PgText");
    expect(cols.stripeSubscriptionId?.columnType).toBe("PgText");
    expect(cols.stripeSubscriptionStatus?.columnType).toBe("PgText");
    expect(cols.currentPeriodEnd?.columnType).toBe("PgTimestamp");
    expect(cols.cancelAtPeriodEnd?.columnType).toBe("PgBoolean");
    expect(cols.billingCycle?.columnType).toBe("PgEnumColumn");
    // Stripe columns are nullable metadata — none may be NOT NULL except the
    // defaulted cancel flag, so resolveEffectiveTier never depends on them.
    expect(cols.stripeCustomerId?.notNull).toBe(false);
    expect(cols.stripeSubscriptionId?.notNull).toBe(false);
    expect(cols.billingCycle?.notNull).toBe(false);
    expect(cols.currentPeriodEnd?.notNull).toBe(false);
  });

  it("defines the stripe_processed_events idempotency table with event_id PK + stripe_event_ts", () => {
    expect(isTable(stripeProcessedEvents)).toBe(true);
    const cols = getTableColumns(stripeProcessedEvents);
    expect(cols.eventId?.columnType).toBe("PgText");
    expect(cols.eventId?.primary).toBe(true);
    expect(cols.type?.columnType).toBe("PgText");
    expect(cols.stripeEventTs?.columnType).toBe("PgTimestamp");
    expect(cols.receivedAt?.columnType).toBe("PgTimestamp");
  });

  it("extends billing_source with 'stripe' additively (11a values preserved and ordered first)", () => {
    expect(billingSourceEnum.enumValues).toEqual([
      "system",
      "backfill",
      "admin_override",
      "stripe",
    ]);
  });

  it("defines the billing_cycle enum as exactly {monthly, annual}", () => {
    expect(billingCycleEnum.enumValues).toEqual(["monthly", "annual"]);
  });
});

describe("stripe billing migration (11b Slice 1)", () => {
  it("is registered as the next journal entry after 11a, strictly increasing and non-future", () => {
    const now = Date.now();
    const entry = migrationJournal.entries.find((e) => e.tag === "0012_stripe_billing");
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(12);
    expect(entry!.when).toBeLessThanOrEqual(now);
    const prior = migrationJournal.entries.find((e) => e.tag === "0011_abnormal_squadron_sinister");
    expect(entry!.when).toBeGreaterThan(prior!.when);
  });

  it("adds the stripe columns and cycle enum with safe defaults (metadata-only, no rewrite)", () => {
    expect(migrationSql).toContain('CREATE TYPE "public"."billing_cycle" AS ENUM(\'monthly\', \'annual\')');
    expect(migrationSql).toContain('ALTER TYPE "public"."billing_source" ADD VALUE');
    expect(migrationSql).toContain('ADD COLUMN "stripe_customer_id" text');
    expect(migrationSql).toContain('ADD COLUMN "stripe_subscription_id" text');
    expect(migrationSql).toContain('ADD COLUMN "stripe_subscription_status" text');
    expect(migrationSql).toContain('ADD COLUMN "current_period_end" timestamp');
    expect(migrationSql).toContain('ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL');
    expect(migrationSql).toContain('ADD COLUMN "billing_cycle" "billing_cycle"');
  });

  it("creates the stripe_processed_events table keyed by event_id and stays non-destructive", () => {
    expect(migrationSql).toContain('CREATE TABLE "stripe_processed_events"');
    expect(migrationSql).toContain('"event_id" text PRIMARY KEY NOT NULL');
    expect(migrationSql).toContain('"stripe_event_ts" timestamp');
    expect(migrationSql).toContain('"received_at" timestamp with time zone DEFAULT now() NOT NULL');
    expect(migrationSql).not.toContain("DROP TABLE");
    expect(migrationSql).not.toContain("DROP COLUMN");
  });
});
