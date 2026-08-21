import type { MembershipRole } from "@kinora/contracts";
import type { BillingTier } from "./types.js";

/**
 * Sentinel `endsAt` for an open-ended grant. `endsAt` is `NOT NULL` on
 * `tenant_billing_overrides` (schema check `endsAt > startsAt`), so an
 * open-ended override cannot use `NULL` — this far-future timestamp sorts
 * last in the `.orderBy(endsAt)` ascending active-override query and stays
 * well within the timestamptz range (max year 294276).
 */
export const OPEN_ENDED_SENTINEL = new Date("9999-12-31T00:00:00Z");

const GRANTABLE_TIERS: readonly BillingTier[] = ["trainer", "gym"];

function isGrantableTier(tier: string): tier is BillingTier {
  return (GRANTABLE_TIERS as readonly string[]).includes(tier);
}

export interface TenantBillingOverrideRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Shape returned by `loadActiveOverride`. `tier` is required (#449) so
 * `RevokeTenantTierOverride` can decide whether the override being revoked is
 * a `trainer` override — the only tier that requires demoting the tenant
 * owner's `memberships.role` back to `owner`.
 */
export interface ActiveTierOverrideRow {
  id: string;
  tier: BillingTier;
}

export interface GrantTierOverrideInput {
  tenantId: string;
  actorUserId: string;
  tier: BillingTier;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  /**
   * Optional caller-supplied idempotency key (#313). When present and an
   * override with this key already exists for the tenant, the adapter returns
   * that original override (idempotent replay) instead of inserting a new row
   * or reporting an `active_override_exists` conflict — so a grant retried
   * after a network timeout resolves to the first attempt's result.
   */
  operationKey?: string;
}

export interface RevokeTierOverrideInput {
  tenantId: string;
  overrideId: string;
  actorUserId: string;
  now: Date;
}

/**
 * Port the pure grant/revoke use cases depend on. The concrete
 * `TierOverrideAdminRepository` (db/repositories/tier-override-admin.ts) runs
 * `grantTierOverride`/`revokeTierOverride` as ONE transaction pairing the
 * override write with its audit row.
 */
export interface TierOverrideAdminPort {
  loadTenant(tenantId: string): Promise<{ id: string } | null>;
  loadActiveOverride(tenantId: string, now: Date): Promise<ActiveTierOverrideRow | null>;
  /**
   * Grants the override. The adapter runs this as ONE transaction that
   * (1) takes a per-tenant Postgres advisory lock, (2) when an `operationKey`
   * is supplied, returns any pre-existing override carrying that key
   * (idempotent replay — #313), (3) otherwise RE-CHECKS for an active
   * override under that lock, and (4) inserts only if still clear — this
   * serializes concurrent grants for the same tenant. Resolves `null`
   * (instead of throwing) when the transactional re-check finds a
   * concurrently-committed active override, so the caller can map it to the
   * same `active_override_exists` conflict the fast-path check above
   * produces.
   */
  grantTierOverride(input: GrantTierOverrideInput): Promise<TenantBillingOverrideRow | null>;
  /**
   * Revokes the override. The adapter runs this as ONE transaction that takes
   * a per-tenant advisory lock and guards the `endsAt = now` UPDATE with
   * `ends_at > now`, so a SECOND concurrent revoke of the same override
   * updates zero rows — no duplicate `admin_override_expired` audit row or
   * observability event is written (#315). Always resolves the row's current
   * `{ id, endsAt }` (idempotent success for an already-revoked override).
   */
  revokeTierOverride(input: RevokeTierOverrideInput): Promise<{ id: string; endsAt: Date }>;
  /**
   * Transitions the tenant's OWNER membership role (#449) — grants of the
   * `trainer` tier must ALSO promote `memberships.role` from `owner` to
   * `trainer` so `assertTrainerEntitled` (owner-access.ts), which requires
   * BOTH role and entitlement, actually admits an admin-provisioned trainer.
   * Revoking a `trainer` override symmetrically demotes `trainer` back to
   * `owner`.
   *
   * Scoped `WHERE tenant_id = $1 AND role = $2` — MUST NEVER match a
   * `member` row (invited clients share the same tenant). Resolves the
   * number of rows updated: `0` is a normal idempotent outcome (e.g. the
   * owner membership is already `trainer` on a replayed grant), never an
   * error.
   */
  setTenantOwnerRole(tenantId: string, from: MembershipRole, to: MembershipRole): Promise<number>;
}

/** Request shape from the route layer — `tier` is unvalidated user input. */
export interface GrantTierOverrideRequest {
  tenantId: string;
  actorUserId: string;
  tier: string;
  reason: string;
  startsAt?: Date;
  endsAt?: Date;
  /** Optional idempotency key (#313); see `GrantTierOverrideInput.operationKey`. */
  operationKey?: string;
}

export interface RevokeTierOverrideRequest {
  tenantId: string;
  actorUserId: string;
}

export type TierOverrideDenialReason =
  | "unknown_tenant"
  | "active_override_exists"
  | "invalid_tier"
  | "invalid_reason"
  | "invalid_date_range"
  | "no_active_override";

export type GrantTierOverrideOutcome =
  | {
      ok: true;
      override: {
        id: string;
        tenantId: string;
        tier: BillingTier;
        reason: string;
        startsAt: Date;
        endsAt: Date;
      };
    }
  | { ok: false; reason: TierOverrideDenialReason };

export type RevokeTierOverrideOutcome =
  | { ok: true; override: { id: string; tenantId: string; endsAt: Date } }
  | { ok: false; reason: TierOverrideDenialReason };

/**
 * Grant a `trainer`/`gym` tier override to a tenant (`GrantTenantTierOverride`
 * use case). Validation order: tier enum → reason presence → date range →
 * tenant existence → overlap guard. Fail-closed: any rejection writes nothing.
 */
export class GrantTenantTierOverride {
  constructor(private readonly port: TierOverrideAdminPort) {}

  async execute(
    input: GrantTierOverrideRequest,
    now: Date = new Date(),
  ): Promise<GrantTierOverrideOutcome> {
    if (!isGrantableTier(input.tier)) {
      return { ok: false, reason: "invalid_tier" };
    }

    if (!input.reason || input.reason.trim().length === 0) {
      return { ok: false, reason: "invalid_reason" };
    }

    const startsAt = input.startsAt ?? now;
    const endsAt = input.endsAt ?? OPEN_ENDED_SENTINEL;
    if (endsAt.getTime() <= startsAt.getTime()) {
      return { ok: false, reason: "invalid_date_range" };
    }

    const tenant = await this.port.loadTenant(input.tenantId);
    if (!tenant) {
      return { ok: false, reason: "unknown_tenant" };
    }

    // Fast-path overlap guard. SKIPPED when an `operationKey` is present (#313):
    // a retried grant whose original is still active would otherwise be
    // rejected here as `active_override_exists` before the adapter could
    // recognise the key and replay the original. With a key, the adapter's
    // locked transaction is the sole authority — it replays on a key match and
    // still resolves `null` (mapped to 409 below) for a genuine different-key
    // grant that collides with an active override.
    if (!input.operationKey) {
      const activeOverride = await this.port.loadActiveOverride(input.tenantId, now);
      if (activeOverride) {
        return { ok: false, reason: "active_override_exists" };
      }
    }

    const created = await this.port.grantTierOverride({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      tier: input.tier,
      reason: input.reason,
      startsAt,
      endsAt,
      operationKey: input.operationKey,
    });

    if (!created) {
      // Lost the race: the adapter's own transaction (advisory-lock +
      // re-check) found a concurrently-committed active override.
      return { ok: false, reason: "active_override_exists" };
    }

    // Role promotion (#449): a `trainer` grant ALSO promotes the tenant
    // owner's membership role, so `assertTrainerEntitled` (which requires
    // BOTH role and entitlement) admits this tenant. Runs AFTER the override
    // write succeeds — a denied/failed grant never touches roles — and on
    // EVERY successful trainer grant, including an idempotent replay
    // (#313), so a retried grant still ends up with the role set even if
    // the original attempt's role write was lost. `gym` grants never touch
    // roles.
    if (input.tier === "trainer") {
      await this.port.setTenantOwnerRole(input.tenantId, "owner", "trainer");
    }

    return {
      ok: true,
      override: {
        id: created.id,
        tenantId: input.tenantId,
        tier: input.tier,
        reason: input.reason,
        startsAt: created.startsAt,
        endsAt: created.endsAt,
      },
    };
  }
}

/**
 * Revoke a tenant's active tier override (`RevokeTenantTierOverride` use
 * case). Sets `endsAt = now`, never deletes the row. Rejects with
 * `no_active_override` when there is nothing to revoke.
 */
export class RevokeTenantTierOverride {
  constructor(private readonly port: TierOverrideAdminPort) {}

  async execute(
    input: RevokeTierOverrideRequest,
    now: Date = new Date(),
  ): Promise<RevokeTierOverrideOutcome> {
    const activeOverride = await this.port.loadActiveOverride(input.tenantId, now);
    if (!activeOverride) {
      return { ok: false, reason: "no_active_override" };
    }

    const revoked = await this.port.revokeTierOverride({
      tenantId: input.tenantId,
      overrideId: activeOverride.id,
      actorUserId: input.actorUserId,
      now,
    });

    // Role demotion (#449): revoking a `trainer` override symmetrically
    // demotes the tenant owner's membership role back to `owner`. Revoking a
    // `gym` override never touches roles.
    if (activeOverride.tier === "trainer") {
      await this.port.setTenantOwnerRole(input.tenantId, "trainer", "owner");
    }

    return {
      ok: true,
      override: { id: revoked.id, tenantId: input.tenantId, endsAt: revoked.endsAt },
    };
  }
}
