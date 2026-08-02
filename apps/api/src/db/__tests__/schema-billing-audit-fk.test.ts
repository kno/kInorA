/**
 * 16d Phase 1 — asserts `billingAuditEvents.actorUserId` is a PLAIN FK to
 * `users.id`, NOT the composite `(tenantId, actorUserId) -> memberships`
 * FK. This unblocks a global superadmin (who may have zero membership rows
 * for the target tenant) from being recorded as the audit actor.
 *
 * RED (before Phase 1 GREEN): the schema still declares `actorMembershipFk`
 * (composite FK to `memberships`), so `foreignKeys` has exactly ONE entry
 * whose foreign table is `memberships`, not `users` — this test fails.
 */
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import { billingAuditEvents } from "../schema.js";

describe("billingAuditEvents schema — actorUserId FK (16d Phase 1)", () => {
  it("actorUserId references users.id directly (not a tenant-membership composite FK)", () => {
    const { foreignKeys } = getTableConfig(billingAuditEvents);

    const actorFks = foreignKeys.filter((fk) => {
      const ref = fk.reference();
      return ref.columns.some((c) => c.name === "actor_user_id");
    });

    expect(actorFks).toHaveLength(1);

    const ref = actorFks[0]!.reference();
    expect(getTableName(ref.foreignTable)).toBe("users");
    expect(ref.columns.map((c) => c.name)).toEqual(["actor_user_id"]);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
  });
});
