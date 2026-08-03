import { describe, it, expect, vi } from "vitest";
import {
  SeatSyncService,
  TrainerSeatSource,
  type SponsorSeatStore,
  type SeatSource,
} from "../seat-sync.js";
import type { SubscriptionGateway } from "../stripe-gateway.js";

const TENANT = "bbbbbbbb-0000-0000-0000-000000000001";

/**
 * A fake `SponsorSeatStore` whose `withSponsorLock` simply runs the callback
 * (no real lock — the advisory-lock serialization is proven in the real-
 * Postgres integration suite). It hands the callback a configurable
 * `stripeSubscriptionId` so these pure tests can exercise the no-op-when-no-
 * subscription branch.
 */
function fakeStore(
  stripeSubscriptionId: string | null,
  drift: string[] = [],
): SponsorSeatStore & { withSponsorLock: ReturnType<typeof vi.fn> } {
  return {
    withSponsorLock: vi.fn(async (_tenantId: string, work: (s: { stripeSubscriptionId: string | null }) => Promise<unknown>) =>
      work({ stripeSubscriptionId }),
    ),
    findSponsorsWithSeatDrift: vi.fn(async () => drift),
  };
}

function fakeSeatSource(count: number): SeatSource {
  return { countActiveSeats: vi.fn(async () => count) };
}

function fakeGateway(): SubscriptionGateway & { updateSubscriptionQuantity: ReturnType<typeof vi.fn> } {
  return { updateSubscriptionQuantity: vi.fn(async () => undefined) };
}

describe("TrainerSeatSource", () => {
  it("delegates countActiveSeats to the repo's countActiveByTrainer", async () => {
    const repo = { countActiveByTrainer: vi.fn(async () => 4) };
    const source = new TrainerSeatSource(repo);

    await expect(source.countActiveSeats(TENANT)).resolves.toBe(4);
    expect(repo.countActiveByTrainer).toHaveBeenCalledWith(TENANT);
  });
});

describe("SeatSyncService.syncSeats — SEAT_BILLING_ENABLED feature flag (design.md Migration/Rollout)", () => {
  it("with the flag OFF (default), never calls updateSubscriptionQuantity even when the tenant has active seats + a subscription id", async () => {
    const store = fakeStore("sub_123");
    const gateway = fakeGateway();
    // No 5th arg ⇒ defaults to disabled — the outbound path must be a
    // complete no-op on the Stripe side.
    const service = new SeatSyncService(fakeSeatSource(3), store, gateway);

    await expect(service.syncSeats(TENANT)).resolves.toBeUndefined();

    expect(gateway.updateSubscriptionQuantity).not.toHaveBeenCalled();
    // The DB recompute + lock still run — harmless-but-skippable.
    expect(store.withSponsorLock).toHaveBeenCalledWith(TENANT, expect.any(Function));
  });

  it("with the flag explicitly OFF, still no-ops even with a zero-seat sponsor (floor never reaches Stripe)", async () => {
    const store = fakeStore("sub_zero");
    const gateway = fakeGateway();
    const service = new SeatSyncService(fakeSeatSource(0), store, gateway, undefined, false);

    await service.syncSeats(TENANT);

    expect(gateway.updateSubscriptionQuantity).not.toHaveBeenCalled();
  });
});

describe("SeatSyncService.syncSeats", () => {
  it("recomputes the active count and updates Stripe with the recomputed quantity + idempotency key", async () => {
    const store = fakeStore("sub_123");
    const gateway = fakeGateway();
    const service = new SeatSyncService(fakeSeatSource(3), store, gateway, undefined, true);

    await service.syncSeats(TENANT);

    expect(gateway.updateSubscriptionQuantity).toHaveBeenCalledWith(
      "sub_123",
      3,
      `seat-sync:${TENANT}:3`,
      [],
    );
    // The recompute + update ran under the per-sponsor lock.
    expect(store.withSponsorLock).toHaveBeenCalledWith(TENANT, expect.any(Function));
  });

  it("floors the Stripe quantity to max(1, count) so a zero-seat sponsor stays at quantity 1", async () => {
    const store = fakeStore("sub_zero");
    const gateway = fakeGateway();
    const service = new SeatSyncService(fakeSeatSource(0), store, gateway, undefined, true);

    await service.syncSeats(TENANT);

    expect(gateway.updateSubscriptionQuantity).toHaveBeenCalledWith(
      "sub_zero",
      1,
      `seat-sync:${TENANT}:1`,
      [],
    );
  });

  it("is a graceful no-op when the sponsor has no Stripe subscription (not a seat customer)", async () => {
    const store = fakeStore(null);
    const gateway = fakeGateway();
    const seatSource = fakeSeatSource(5);
    const service = new SeatSyncService(seatSource, store, gateway, undefined, true);

    await expect(service.syncSeats(TENANT)).resolves.toBeUndefined();
    expect(gateway.updateSubscriptionQuantity).not.toHaveBeenCalled();
  });

  it("never throws a Stripe failure into the caller — the reconcile path heals the drift", async () => {
    const store = fakeStore("sub_fail");
    const gateway = fakeGateway();
    gateway.updateSubscriptionQuantity.mockRejectedValueOnce(new Error("stripe 500"));
    const onError = vi.fn();
    const service = new SeatSyncService(fakeSeatSource(2), store, gateway, onError, true);

    await expect(service.syncSeats(TENANT)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(TENANT, expect.any(Error));
  });
});

// ---------------------------------------------------------------------------
// SEAT-PRICE GUARD (fix/seat-sync-price-guard) — `SEAT_BILLING_ENABLED` alone
// never proves the sponsor's subscription IS a per-seat Trainer Seat one (the
// trainer/gym tier is granted by an independent admin override, so a tenant
// can hold a flat Pro subscription AND a trainer override). The actual guard
// logic lives in the gateway adapter; this service's contract is simply to
// forward the config-injected `seatPriceIds` through on EVERY call so the
// gateway can enforce it. These tests assert that forwarding contract at the
// service boundary — the gateway's own no-op behavior is proven in
// `db/repositories/__tests__/stripe-gateway.test.ts`.
// ---------------------------------------------------------------------------
describe("SeatSyncService — SEAT-PRICE GUARD forwarding (fix/seat-sync-price-guard)", () => {
  it("forwards the configured seatPriceIds through to gateway.updateSubscriptionQuantity on every call", async () => {
    const store = fakeStore("sub_123");
    const gateway = fakeGateway();
    const seatPriceIds = ["price_seat_monthly", "price_seat_annual"];
    const service = new SeatSyncService(fakeSeatSource(3), store, gateway, undefined, true, seatPriceIds);

    await service.syncSeats(TENANT);

    expect(gateway.updateSubscriptionQuantity).toHaveBeenCalledWith(
      "sub_123",
      3,
      `seat-sync:${TENANT}:3`,
      seatPriceIds,
    );
  });

  it("defaults to an empty seatPriceIds array when not configured — the gateway then no-ops for every subscription", async () => {
    const store = fakeStore("sub_123");
    const gateway = fakeGateway();
    const service = new SeatSyncService(fakeSeatSource(3), store, gateway, undefined, true);

    await service.syncSeats(TENANT);

    expect(gateway.updateSubscriptionQuantity).toHaveBeenCalledWith(
      "sub_123",
      3,
      `seat-sync:${TENANT}:3`,
      [],
    );
  });
});

describe("SeatSyncService.reconcileAllStaleSponsors", () => {
  it("reconciles every drifted sponsor the store reports, each under its own lock", async () => {
    const drifted = ["tenant-a", "tenant-b"];
    const store = fakeStore("sub_x", drifted);
    const gateway = fakeGateway();
    const service = new SeatSyncService(fakeSeatSource(1), store, gateway, undefined, true);

    const reconciled = await service.reconcileAllStaleSponsors();

    expect(reconciled).toEqual(drifted);
    expect(store.withSponsorLock).toHaveBeenCalledTimes(2);
    expect(store.withSponsorLock).toHaveBeenNthCalledWith(1, "tenant-a", expect.any(Function));
    expect(store.withSponsorLock).toHaveBeenNthCalledWith(2, "tenant-b", expect.any(Function));
    expect(gateway.updateSubscriptionQuantity).toHaveBeenCalledTimes(2);
  });
});
