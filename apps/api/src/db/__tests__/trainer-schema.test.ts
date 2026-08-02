import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";
import {
  billingTierEnum,
  membershipRoleEnum,
  trainerAssignmentStatusEnum,
  trainerClientAssignments,
} from "../schema.js";

const enumMigrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0016_trainer_role_tier_enum.sql", import.meta.url)),
  "utf8",
);

const tableMigrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0017_trainer_client_assignments.sql", import.meta.url)),
  "utf8",
);

const migrationJournal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../drizzle/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

/**
 * Trainer account access (15a v2 Slice 1) schema shape — additive, dark.
 *
 * No route or authorization behavior changes in this slice. This proves:
 *   1. `trainer` was added to `membership_role` and `billing_tier` additively
 *      (existing values preserved, ordered first).
 *   2. A new `trainer_assignment_status` enum and `trainer_client_assignments`
 *      table exist with the design's exact shape, including the
 *      one-trainer-per-client partial unique index.
 *   3. Postgres's `ALTER TYPE ... ADD VALUE` same-transaction gotcha is
 *      respected: the enum-value additions live in their own migration file,
 *      separate from the file that creates the table using those values.
 */
describe("trainer schema shape (15a-v2 Slice 1)", () => {
  it("extends membership_role with 'trainer' additively (existing values preserved)", () => {
    expect(membershipRoleEnum.enumValues).toEqual(["owner", "member", "trainer"]);
  });

  it("extends billing_tier with 'trainer' additively (existing values preserved)", () => {
    // 16a-v3-gym-white-label, Slice 1 later appends 'gym' additively after
    // 'trainer'; this assertion only proves 'trainer's own ordinal position.
    expect(billingTierEnum.enumValues.slice(0, 3)).toEqual(["free", "pro", "trainer"]);
  });

  it("defines trainer_assignment_status as exactly {invited, active, revoked}", () => {
    expect(trainerAssignmentStatusEnum.enumValues).toEqual(["invited", "active", "revoked"]);
  });

  it("defines the trainer_client_assignments table with tenant/trainer/client scoping", () => {
    expect(isTable(trainerClientAssignments)).toBe(true);
    const cols = getTableColumns(trainerClientAssignments);
    expect(cols.id?.primary).toBe(true);
    expect(cols.tenantId?.columnType).toBe("PgUUID");
    expect(cols.tenantId?.notNull).toBe(true);
    expect(cols.trainerUserId?.columnType).toBe("PgUUID");
    expect(cols.trainerUserId?.notNull).toBe(true);
    expect(cols.clientUserId?.columnType).toBe("PgUUID");
    expect(cols.clientUserId?.notNull).toBe(true);
    expect(cols.status?.columnType).toBe("PgEnumColumn");
    expect(cols.status?.notNull).toBe(true);
    expect(cols.createdAt?.notNull).toBe(true);
    expect(cols.updatedAt?.notNull).toBe(true);
  });
});

describe("trainer migration split (15a-v2 Slice 1)", () => {
  it("registers both migrations as strictly increasing, non-future journal entries after 0015", () => {
    const now = Date.now();
    const enumEntry = migrationJournal.entries.find((e) => e.tag === "0016_trainer_role_tier_enum");
    const tableEntry = migrationJournal.entries.find(
      (e) => e.tag === "0017_trainer_client_assignments",
    );
    const prior = migrationJournal.entries.find((e) => e.tag === "0015_plan_draft_version");

    expect(enumEntry).toBeDefined();
    expect(tableEntry).toBeDefined();
    expect(enumEntry!.idx).toBe(16);
    expect(tableEntry!.idx).toBe(17);
    expect(enumEntry!.when).toBeGreaterThan(prior!.when);
    expect(tableEntry!.when).toBeGreaterThan(enumEntry!.when);
    expect(enumEntry!.when).toBeLessThanOrEqual(now);
    expect(tableEntry!.when).toBeLessThanOrEqual(now);
  });

  it("step A ONLY adds the two enum values — never references them (same-transaction gotcha)", () => {
    expect(enumMigrationSql).toContain(
      "ALTER TYPE \"public\".\"membership_role\" ADD VALUE IF NOT EXISTS 'trainer'",
    );
    expect(enumMigrationSql).toContain(
      "ALTER TYPE \"public\".\"billing_tier\" ADD VALUE IF NOT EXISTS 'trainer'",
    );
    expect(enumMigrationSql).not.toContain("CREATE TABLE");
    expect(enumMigrationSql).not.toContain("'trainer'::");
  });

  it("step B creates the assignment enum + table + both unique indexes, never touching membership_role/billing_tier", () => {
    expect(tableMigrationSql).toContain('CREATE TYPE "public"."trainer_assignment_status"');
    expect(tableMigrationSql).toContain('CREATE TABLE "trainer_client_assignments"');
    expect(tableMigrationSql).toContain("trainer_client_assignments_client_active_unique");
    expect(tableMigrationSql).toContain("trainer_client_assignments_tenant_client_unique");
    expect(tableMigrationSql).not.toContain("ADD VALUE");
    expect(tableMigrationSql).not.toContain("DROP TABLE");
    expect(tableMigrationSql).not.toContain("DROP COLUMN");
  });
});
