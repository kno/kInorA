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

export interface GrantTierOverrideInput {
  tenantId: string;
  actorUserId: string;
  tier: BillingTier;
  reason: string;
  startsAt: Date;
  endsAt: Date;
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
  loadActiveOverride(tenantId: string, now: Date): Promise<{ id: string } | null>;
  /**
   * Grants the override. The adapter runs this as ONE transaction that
   * (1) takes a per-tenant Postgres advisory lock, (2) RE-CHECKS for an
   * active override under that lock, and (3) inserts only if still clear —
   * this serializes concurrent grants for the same tenant. Resolves `null`
   * (instead of throwing) when the transactional re-check finds a
   * concurrently-committed active override, so the caller can map it to the
   * same `active_override_exists` conflict the fast-path check above
   * produces.
   */
  grantTierOverride(input: GrantTierOverrideInput): Promise<TenantBillingOverrideRow | null>;
  revokeTierOverride(input: RevokeTierOverrideInput): Promise<{ id: string; endsAt: Date }>;
}

/** Request shape from the route layer — `tier` is unvalidated user input. */
export interface GrantTierOverrideRequest {
  tenantId: string;
  actorUserId: string;
  tier: string;
  reason: string;
  startsAt?: Date;
  endsAt?: Date;
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

    const activeOverride = await this.port.loadActiveOverride(input.tenantId, now);
    if (activeOverride) {
      return { ok: false, reason: "active_override_exists" };
    }

    const created = await this.port.grantTierOverride({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      tier: input.tier,
      reason: input.reason,
      startsAt,
      endsAt,
    });

    if (!created) {
      // Lost the race: the adapter's own transaction (advisory-lock +
      // re-check) found a concurrently-committed active override.
      return { ok: false, reason: "active_override_exists" };
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

    return {
      ok: true,
      override: { id: revoked.id, tenantId: input.tenantId, endsAt: revoked.endsAt },
    };
  }
}
