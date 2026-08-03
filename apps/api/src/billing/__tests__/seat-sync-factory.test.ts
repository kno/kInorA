import { describe, it, expect, vi } from "vitest";
import { buildSeatSyncService } from "../seat-sync-factory.js";
import { SeatSyncService, type SponsorSeatStore } from "../seat-sync.js";
import type { Database } from "../../db/client.js";

const TENANT = "cccccccc-0000-0000-0000-000000000001";

/**
 * Never actually touched by these tests: every DB-shaped dependency
 * (`TrainerAssignmentRepository`, `SeatSyncStore`) is overridden via the
 * factory's injection seams below. Only its identity matters.
 */
const fakeDatabase = {} as Database;

/** Mirrors `seat-sync.test.ts`'s fake store — runs the callback directly (no real lock). */
function fakeStore(stripeSubscriptionId: string | null): SponsorSeatStore {
  return {
    withSponsorLock: vi.fn(async (_tenantId: string, work: (s: { stripeSubscriptionId: string | null }) => Promise<unknown>) =>
      work({ stripeSubscriptionId }),
    ),
    findSponsorsWithSeatDrift: vi.fn(async () => []),
  };
}

describe("buildSeatSyncService", () => {
  it("returns a real SeatSyncService instance", () => {
    const service = buildSeatSyncService({
      database: fakeDatabase,
      env: {},
      trainerAssignmentRepo: { countActiveByTrainer: vi.fn(async () => 0) },
    });

    expect(service).toBeInstanceOf(SeatSyncService);
  });

  it("with SEAT_BILLING_ENABLED unset (default off), never calls the Stripe gateway even with active seats + a subscription", async () => {
    const updateSubscriptionQuantity = vi.fn(async () => undefined);
    const service = buildSeatSyncService({
      database: fakeDatabase,
      env: {},
      trainerAssignmentRepo: { countActiveByTrainer: vi.fn(async () => 3) },
      stripeGateway: { updateSubscriptionQuantity },
      store: fakeStore("sub_123"),
    });

    await service.reconcileSeats(TENANT);

    expect(updateSubscriptionQuantity).not.toHaveBeenCalled();
  });

  it("with SEAT_BILLING_ENABLED=1, forwards the recomputed quantity + resolved seat price ids to the Stripe gateway", async () => {
    const updateSubscriptionQuantity = vi.fn(async () => undefined);
    const service = buildSeatSyncService({
      database: fakeDatabase,
      env: {
        SEAT_BILLING_ENABLED: "1",
        STRIPE_PRICE_TRAINER_SEAT_MONTHLY: "price_seat_monthly",
        STRIPE_PRICE_TRAINER_SEAT_ANNUAL: "price_seat_annual",
      },
      trainerAssignmentRepo: { countActiveByTrainer: vi.fn(async () => 4) },
      stripeGateway: { updateSubscriptionQuantity },
      store: fakeStore("sub_456"),
    });

    await service.reconcileSeats(TENANT);

    expect(updateSubscriptionQuantity).toHaveBeenCalledWith(
      "sub_456",
      4,
      expect.stringContaining(TENANT),
      ["price_seat_monthly", "price_seat_annual"],
    );
  });

  it("with SEAT_BILLING_ENABLED=1 but no Trainer Seat price ids configured, the price-id guard leaves the gateway's forwarded list empty", async () => {
    const updateSubscriptionQuantity = vi.fn(async () => undefined);
    const service = buildSeatSyncService({
      database: fakeDatabase,
      env: { SEAT_BILLING_ENABLED: "1" },
      trainerAssignmentRepo: { countActiveByTrainer: vi.fn(async () => 1) },
      stripeGateway: { updateSubscriptionQuantity },
      store: fakeStore("sub_789"),
    });

    await service.reconcileSeats(TENANT);

    expect(updateSubscriptionQuantity).toHaveBeenCalledWith(
      "sub_789",
      1,
      expect.any(String),
      [],
    );
  });

  it("never throws at construction time when Stripe env is unset and no stripeGateway override is provided (fail-closed fallback, only reachable if the flag were ever on)", () => {
    expect(() =>
      buildSeatSyncService({
        database: fakeDatabase,
        env: {},
        trainerAssignmentRepo: { countActiveByTrainer: vi.fn(async () => 0) },
        store: fakeStore(null),
      }),
    ).not.toThrow();
  });
});
