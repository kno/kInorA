import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  BillingTier,
  ClientSummaryDTO,
  InviteClientRequest,
  MembershipRole,
  TenantId,
  TrainerAssignmentStatus,
  TrainerClientAssignmentDTO,
  UserId,
} from "../index";

/**
 * Trainer account access (15a v2, Slice 1) — additive contract surface.
 *
 * Slice 1 is dark/additive: no route or behavior change. This only proves the
 * `MembershipRole`/`BillingTier` unions gained the `trainer` value and the
 * assignment DTOs are shaped exactly per design.md's "Interfaces / Contracts"
 * section, without disturbing any existing consumer of these types.
 */
describe("trainer account access contracts (15a v2 Slice 1)", () => {
  it("extends MembershipRole with 'trainer' while keeping the existing values", () => {
    expectTypeOf<MembershipRole>().toEqualTypeOf<"owner" | "member" | "trainer">();
    const role: MembershipRole = "trainer";
    expect(role).toBe("trainer");
  });

  it("extends BillingTier with 'trainer' while keeping the existing values", () => {
    expectTypeOf<BillingTier>().toEqualTypeOf<"free" | "pro" | "trainer">();
    const tier: BillingTier = "trainer";
    expect(tier).toBe("trainer");
  });

  it("defines TrainerAssignmentStatus as exactly invited | active | revoked", () => {
    expectTypeOf<TrainerAssignmentStatus>().toEqualTypeOf<"invited" | "active" | "revoked">();
    const statuses: TrainerAssignmentStatus[] = ["invited", "active", "revoked"];
    expect(statuses).toEqual(["invited", "active", "revoked"]);
  });

  it("defines TrainerClientAssignmentDTO per design's Interfaces/Contracts shape", () => {
    expectTypeOf<TrainerClientAssignmentDTO>().toEqualTypeOf<{
      id: string;
      tenantId: TenantId;
      trainerUserId: UserId;
      clientUserId: UserId;
      status: TrainerAssignmentStatus;
    }>();
  });

  it("defines InviteClientRequest as an email-only payload", () => {
    expectTypeOf<InviteClientRequest>().toEqualTypeOf<{ email: string }>();
  });

  it("defines ClientSummaryDTO for the trainer client-list surface", () => {
    expectTypeOf<ClientSummaryDTO>().toEqualTypeOf<{
      clientUserId: UserId;
      email: string;
      status: TrainerAssignmentStatus;
    }>();
  });
});
