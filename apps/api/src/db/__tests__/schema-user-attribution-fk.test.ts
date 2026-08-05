/**
 * #354 — user-attribution FKs must be `ON DELETE SET NULL`.
 *
 * These four columns record *who acted*, not *who owns the row*. `CASCADE` would
 * erase a billing audit trail or a tenant's configured entitlements along with
 * the account; `NO ACTION` (the previous state) made `DELETE FROM users` fail
 * outright, so GDPR erasure required staged manual SQL against four tables.
 * `SET NULL` keeps the record and drops only the attribution.
 *
 * Hermetic counterpart to `user-account-deletion.integration.test.ts`: this
 * suite pins the declared schema (runs in every `vitest run`), the integration
 * suite proves real Postgres honours it.
 */
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  billingAuditEvents,
  memberQuotaAllocations,
  tenantBillingOverrides,
} from "../schema.js";

const ATTRIBUTION_COLUMNS: ReadonlyArray<{
  readonly table: PgTable;
  readonly tableName: string;
  readonly column: string;
}> = [
  { table: billingAuditEvents, tableName: "billing_audit_events", column: "actor_user_id" },
  { table: billingAuditEvents, tableName: "billing_audit_events", column: "subject_user_id" },
  {
    table: memberQuotaAllocations,
    tableName: "member_quota_allocations",
    column: "updated_by_user_id",
  },
  {
    table: tenantBillingOverrides,
    tableName: "tenant_billing_overrides",
    column: "created_by_user_id",
  },
];

describe("user-attribution FKs (#354)", () => {
  ATTRIBUTION_COLUMNS.forEach(({ table, tableName, column }) => {
    it(`${tableName}.${column} references users.id with ON DELETE SET NULL`, () => {
      const { foreignKeys } = getTableConfig(table);

      const matching = foreignKeys.filter((fk) =>
        fk.reference().columns.some((c) => c.name === column),
      );

      expect(matching, `${tableName}.${column} must have exactly one FK`).toHaveLength(1);
      const fk = matching[0]!;
      expect(fk.reference().foreignColumns.map((c) => c.name)).toEqual(["id"]);
      expect(fk.onDelete).toBe("set null");
    });

    it(`${tableName}.${column} is nullable so SET NULL can fire`, () => {
      const { columns } = getTableConfig(table);
      const col = columns.find((c) => c.name === column);

      expect(col, `${tableName}.${column} must exist`).toBeDefined();
      expect(col!.notNull).toBe(false);
    });
  });

  it("no FK into users or tenants is left at the NO ACTION default", () => {
    // The four above were found by querying `information_schema` for
    // `delete_rule <> 'CASCADE'`, and a truncated result hid three of them
    // (#354). This asserts the declared schema instead: every FK now states an
    // explicit intent, so a new attribution column cannot silently ship as
    // NO ACTION and re-break account deletion.
    const tables: ReadonlyArray<{ name: string; table: PgTable }> = [
      { name: "billing_audit_events", table: billingAuditEvents },
      { name: "member_quota_allocations", table: memberQuotaAllocations },
      { name: "tenant_billing_overrides", table: tenantBillingOverrides },
    ];

    const withoutRule = tables.flatMap(({ name, table }) =>
      getTableConfig(table)
        .foreignKeys.filter((fk) => fk.onDelete === undefined)
        .map((fk) => `${name}.${fk.reference().columns.map((c) => c.name).join("+")}`),
    );

    expect(withoutRule).toEqual([]);
  });
});
