/**
 * Unit coverage for the pure `GrantTenantTierOverride` / `RevokeTenantTierOverride`
 * use cases (16d-admin-tier-provisioning, Phase 2). A fake `TierOverrideAdminPort`
 * stands in for the transactional Drizzle adapter (covered separately by the
 * real-Postgres integration suite in Phase 3).
 */
import { describe, expect, it, vi } from "vitest";
import {
  GrantTenantTierOverride,
  RevokeTenantTierOverride,
  OPEN_ENDED_SENTINEL,
  type TierOverrideAdminPort,
} from "./tier-override-admin.js";

const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const ACTOR_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const NOW = new Date("2026-08-02T12:00:00Z");

function buildPort(overrides: Partial<TierOverrideAdminPort> = {}): TierOverrideAdminPort {
  return {
    loadTenant: vi.fn().mockResolvedValue({ id: TENANT_ID }),
    loadActiveOverride: vi.fn().mockResolvedValue(null),
    grantTierOverride: vi.fn().mockResolvedValue({
      id: "override-1",
      startsAt: NOW,
      endsAt: OPEN_ENDED_SENTINEL,
    }),
    revokeTierOverride: vi.fn().mockResolvedValue({ id: "override-1", endsAt: NOW }),
    ...overrides,
  };
}

describe("GrantTenantTierOverride", () => {
  it("grants trainer tier with an open-ended sentinel endsAt when no explicit end is given", async () => {
    const port = buildPort();
    const useCase = new GrantTenantTierOverride(port);

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "trainer", reason: "trial extension" },
      NOW,
    );

    expect(outcome).toEqual({
      ok: true,
      override: {
        id: "override-1",
        tenantId: TENANT_ID,
        tier: "trainer",
        reason: "trial extension",
        startsAt: NOW,
        endsAt: OPEN_ENDED_SENTINEL,
      },
    });
    expect(port.grantTierOverride).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: ACTOR_ID,
      tier: "trainer",
      reason: "trial extension",
      startsAt: NOW,
      endsAt: OPEN_ENDED_SENTINEL,
    });
  });

  it("grants gym tier", async () => {
    const port = buildPort({
      grantTierOverride: vi
        .fn()
        .mockResolvedValue({ id: "override-2", startsAt: NOW, endsAt: OPEN_ENDED_SENTINEL }),
    });
    const useCase = new GrantTenantTierOverride(port);

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "gym", reason: "gym pilot" },
      NOW,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.override.tier).toBe("gym");
  });

  it("rejects an unknown tenant (404) without writing an override", async () => {
    const port = buildPort({ loadTenant: vi.fn().mockResolvedValue(null) });
    const useCase = new GrantTenantTierOverride(port);

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "trainer", reason: "x" },
      NOW,
    );

    expect(outcome).toEqual({ ok: false, reason: "unknown_tenant" });
    expect(port.grantTierOverride).not.toHaveBeenCalled();
  });

  it("rejects when an active override already exists (409 overlap)", async () => {
    const port = buildPort({
      loadActiveOverride: vi.fn().mockResolvedValue({ id: "existing-override" }),
    });
    const useCase = new GrantTenantTierOverride(port);

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "gym", reason: "x" },
      NOW,
    );

    expect(outcome).toEqual({ ok: false, reason: "active_override_exists" });
    expect(port.grantTierOverride).not.toHaveBeenCalled();
  });

  it("rejects tier 'pro' as invalid", async () => {
    const port = buildPort();
    const useCase = new GrantTenantTierOverride(port);

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "pro", reason: "x" },
      NOW,
    );

    expect(outcome).toEqual({ ok: false, reason: "invalid_tier" });
    expect(port.loadTenant).not.toHaveBeenCalled();
    expect(port.grantTierOverride).not.toHaveBeenCalled();
  });

  it("rejects tier 'free' as invalid", async () => {
    const port = buildPort();
    const useCase = new GrantTenantTierOverride(port);

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "free", reason: "x" },
      NOW,
    );

    expect(outcome).toEqual({ ok: false, reason: "invalid_tier" });
  });

  it("rejects an empty reason", async () => {
    const port = buildPort();
    const useCase = new GrantTenantTierOverride(port);

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "trainer", reason: "" },
      NOW,
    );

    expect(outcome).toEqual({ ok: false, reason: "invalid_reason" });
    expect(port.grantTierOverride).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only reason", async () => {
    const port = buildPort();
    const useCase = new GrantTenantTierOverride(port);

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "trainer", reason: "   " },
      NOW,
    );

    expect(outcome).toEqual({ ok: false, reason: "invalid_reason" });
  });

  it("rejects endsAt <= startsAt", async () => {
    const port = buildPort();
    const useCase = new GrantTenantTierOverride(port);
    const startsAt = new Date("2026-08-02T12:00:00Z");
    const endsAt = new Date("2026-08-02T12:00:00Z");

    const outcome = await useCase.execute(
      { tenantId: TENANT_ID, actorUserId: ACTOR_ID, tier: "trainer", reason: "x", startsAt, endsAt },
      NOW,
    );

    expect(outcome).toEqual({ ok: false, reason: "invalid_date_range" });
    expect(port.grantTierOverride).not.toHaveBeenCalled();
  });
});

describe("RevokeTenantTierOverride", () => {
  it("revokes the active override, setting endsAt to now via the port", async () => {
    const port = buildPort({
      loadActiveOverride: vi.fn().mockResolvedValue({ id: "override-1" }),
      revokeTierOverride: vi.fn().mockResolvedValue({ id: "override-1", endsAt: NOW }),
    });
    const useCase = new RevokeTenantTierOverride(port);

    const outcome = await useCase.execute({ tenantId: TENANT_ID, actorUserId: ACTOR_ID }, NOW);

    expect(outcome).toEqual({
      ok: true,
      override: { id: "override-1", tenantId: TENANT_ID, endsAt: NOW },
    });
    expect(port.revokeTierOverride).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      overrideId: "override-1",
      actorUserId: ACTOR_ID,
      now: NOW,
    });
  });

  it("rejects revoke when there is no active override", async () => {
    const port = buildPort({ loadActiveOverride: vi.fn().mockResolvedValue(null) });
    const useCase = new RevokeTenantTierOverride(port);

    const outcome = await useCase.execute({ tenantId: TENANT_ID, actorUserId: ACTOR_ID }, NOW);

    expect(outcome).toEqual({ ok: false, reason: "no_active_override" });
    expect(port.revokeTierOverride).not.toHaveBeenCalled();
  });
});
