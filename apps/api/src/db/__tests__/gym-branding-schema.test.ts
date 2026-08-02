import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";
import { billingTierEnum, tenantBranding } from "../schema.js";

const enumMigrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0018_gym_tier_enum.sql", import.meta.url)),
  "utf8",
);

const tableMigrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0019_tenant_branding.sql", import.meta.url)),
  "utf8",
);

const migrationJournal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../drizzle/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

/**
 * Gym white-label branding (16a v3, Slice 1) schema shape — additive, dark.
 *
 * No route or authorization behavior changes in this slice. This proves:
 *   1. `gym` was added to `billing_tier` additively (existing values preserved,
 *      ordered first — same pattern as 15a's `trainer`).
 *   2. `tenant_branding` exists with the design's exact column shape, including
 *      the unique `subdomainSlug` index.
 *   3. The `ALTER TYPE ... ADD VALUE` same-transaction gotcha is respected: the
 *      enum-value addition lives in its own migration file, separate from the
 *      file that creates `tenant_branding`.
 */
describe("gym tier + tenant_branding schema shape (16a v3 Slice 1)", () => {
  it("extends billing_tier with 'gym' additively (existing values preserved)", () => {
    expect(billingTierEnum.enumValues).toEqual(["free", "pro", "trainer", "gym"]);
  });

  it("defines the tenant_branding table with the design's exact column shape", () => {
    expect(isTable(tenantBranding)).toBe(true);
    const cols = getTableColumns(tenantBranding);
    expect(cols.tenantId?.columnType).toBe("PgUUID");
    expect(cols.tenantId?.notNull).toBe(true);
    expect(cols.subdomainSlug?.columnType).toBe("PgText");
    expect(cols.subdomainSlug?.notNull).toBe(true);
    expect(cols.logoStorageKey?.notNull).toBe(false);
    expect(cols.accent?.notNull).toBe(false);
    expect(cols.accentFg?.notNull).toBe(false);
    expect(cols.surface?.notNull).toBe(false);
    expect(cols.surface2?.notNull).toBe(false);
    expect(cols.fg?.notNull).toBe(false);
    expect(cols.muted?.notNull).toBe(false);
    expect(cols.createdAt?.notNull).toBe(true);
    expect(cols.updatedAt?.notNull).toBe(true);
  });
});

describe("gym schema migration split (16a v3 Slice 1)", () => {
  it("registers both migrations as strictly increasing, non-future journal entries after 0017", () => {
    const now = Date.now();
    const enumEntry = migrationJournal.entries.find((e) => e.tag === "0018_gym_tier_enum");
    const tableEntry = migrationJournal.entries.find((e) => e.tag === "0019_tenant_branding");
    const prior = migrationJournal.entries.find(
      (e) => e.tag === "0017_trainer_client_assignments",
    );

    expect(enumEntry).toBeDefined();
    expect(tableEntry).toBeDefined();
    expect(enumEntry!.idx).toBe(18);
    expect(tableEntry!.idx).toBe(19);
    expect(enumEntry!.when).toBeGreaterThan(prior!.when);
    expect(tableEntry!.when).toBeGreaterThan(enumEntry!.when);
    expect(enumEntry!.when).toBeLessThanOrEqual(now);
    expect(tableEntry!.when).toBeLessThanOrEqual(now);
  });

  it("step A ONLY adds the 'gym' enum value — never references it (same-transaction gotcha)", () => {
    expect(enumMigrationSql).toContain(
      "ALTER TYPE \"public\".\"billing_tier\" ADD VALUE IF NOT EXISTS 'gym'",
    );
    expect(enumMigrationSql).not.toContain("CREATE TABLE");
    expect(enumMigrationSql).not.toContain("'gym'::");
  });

  it("step B creates tenant_branding + the unique subdomainSlug index, never touching billing_tier", () => {
    expect(tableMigrationSql).toContain('CREATE TABLE "tenant_branding"');
    expect(tableMigrationSql).toContain("tenant_branding_subdomain_slug_unique");
    expect(tableMigrationSql).not.toContain("ADD VALUE");
    expect(tableMigrationSql).not.toContain("DROP TABLE");
    expect(tableMigrationSql).not.toContain("DROP COLUMN");
  });
});
