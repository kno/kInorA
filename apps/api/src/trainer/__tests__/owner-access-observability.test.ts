import { describe, it, expect, vi } from "vitest";
import {
  resolveAuthorizedOwner,
  ForbiddenOwnerAccess,
  type ActorOwnerContext,
  type OwnerAccessDeps,
} from "../owner-access.js";
import type { ObservabilityLogger } from "../../observability/event-logger.js";
import type { MembershipRole, TenantId, UserId } from "@kinora/contracts";

const TENANT = "44444444-0000-0000-0000-000000000001" as TenantId;
const ACTOR = "55555555-0000-0000-0000-000000000001" as UserId;
const CLIENT = "55555555-0000-0000-0000-000000000002" as UserId;

function buildLogger(): ObservabilityLogger & { recordEvent: ReturnType<typeof vi.fn> } {
  return { recordEvent: vi.fn() };
}

function ctx(role: MembershipRole): ActorOwnerContext {
  return { tenantId: TENANT, actorUserId: ACTOR, role };
}

function deps(
  observability: ObservabilityLogger,
  overrides: Partial<OwnerAccessDeps> = {},
): OwnerAccessDeps {
  return {
    entitlementReader: {
      loadContext: vi.fn().mockResolvedValue({
        membershipStatus: "active",
        billing: null,
        activeOverrideTier: "trainer",
      }),
    },
    assignmentRepo: {
      findActiveAssignment: vi.fn().mockResolvedValue({ id: "assignment-1" }),
    },
    observability,
    ...overrides,
  };
}

describe("resolveAuthorizedOwner observability", () => {
  it("records owner_access.denied (warn, ids only) when the actor is not a trainer", async () => {
    const logger = buildLogger();
    await expect(
      resolveAuthorizedOwner(ctx("member"), deps(logger), CLIENT),
    ).rejects.toBeInstanceOf(ForbiddenOwnerAccess);

    expect(logger.recordEvent).toHaveBeenCalledWith({
      tenantId: TENANT,
      actorUserId: ACTOR,
      level: "warn",
      event: "owner_access.denied",
    });
  });

  it("records the denial when the resolved tier is not trainer", async () => {
    const logger = buildLogger();
    const d = deps(logger, {
      entitlementReader: {
        loadContext: vi.fn().mockResolvedValue({
          membershipStatus: "active",
          billing: null,
          activeOverrideTier: "free",
        }),
      },
    });

    await expect(resolveAuthorizedOwner(ctx("trainer"), d, CLIENT)).rejects.toBeInstanceOf(
      ForbiddenOwnerAccess,
    );
    expect(logger.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", event: "owner_access.denied", tenantId: TENANT }),
    );
  });

  it("records the denial when no active assignment exists", async () => {
    const logger = buildLogger();
    const d = deps(logger, {
      assignmentRepo: { findActiveAssignment: vi.fn().mockResolvedValue(null) },
    });

    await expect(resolveAuthorizedOwner(ctx("trainer"), d, CLIENT)).rejects.toBeInstanceOf(
      ForbiddenOwnerAccess,
    );
    expect(logger.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", event: "owner_access.denied" }),
    );
  });

  it("does NOT record on the self path (no widening requested)", async () => {
    const logger = buildLogger();
    const owner = await resolveAuthorizedOwner(ctx("member"), deps(logger));
    expect(owner).toBe(ACTOR);
    expect(logger.recordEvent).not.toHaveBeenCalled();
  });

  it("does NOT record on a successful widening (authorized trainer)", async () => {
    const logger = buildLogger();
    const owner = await resolveAuthorizedOwner(ctx("trainer"), deps(logger), CLIENT);
    expect(owner).toBe(CLIENT);
    expect(logger.recordEvent).not.toHaveBeenCalled();
  });

  it("works without a logger injected (optional dependency)", async () => {
    const d = deps(buildLogger());
    delete (d as { observability?: unknown }).observability;
    await expect(resolveAuthorizedOwner(ctx("member"), d, CLIENT)).rejects.toBeInstanceOf(
      ForbiddenOwnerAccess,
    );
  });
});
