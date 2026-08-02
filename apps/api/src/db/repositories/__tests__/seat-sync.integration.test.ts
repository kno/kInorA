/**
 * Real-Postgres integration coverage for the seat-sync source + orchestration
 * (16c-v3-b2b-seat-billing, Slice C; design Q3).
 *
 * Proves the concurrency-sensitive parts that a fake store cannot: the
 * `countActiveByTrainer` seat source, the per-sponsor advisory-lock
 * SERIALIZATION of concurrent syncs (the adversarial-target test), and the
 * scheduled-sweep drift detector.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as the
 * other integration suites) — skipped when no real Postgres is wired so the
 * default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDbClient } from "../../client.js";
import { tenants, users, tenantBillingStates } from "../../schema.js";
import { TrainerAssignmentRepository } from "../trainer-assignment.js";
import { SeatSyncStore } from "../seat-sync-store.js";
import { SeatSyncService, TrainerSeatSource } from "../../../billing/seat-sync.js";
import type { SubscriptionGateway } from "../../../billing/stripe-gateway.js";

const hasDb = Boolean(process.env.DATABASE_URL);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasDb)("seat-sync (real Postgres, 16c Slice C)", () => {
  const { db, pool } = createDbClient();
  const assignmentRepo = new TrainerAssignmentRepository(db);
  const seatSource = new TrainerSeatSource(assignmentRepo);
  const store = new SeatSyncStore(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [t] = await db
      .insert(tenants)
      .values({ name: `seat-sync-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return t!.id;
  }

  async function seedUser(): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email: `seat-sync-${Date.now()}-${Math.random()}@example.test` })
      .returning({ id: users.id });
    return u!.id;
  }

  async function seedStripeSponsor(tenantId: string, subId: string | null, seatCount: number | null): Promise<void> {
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "trainer",
      status: "active",
      source: "stripe",
      stripeSubscriptionId: subId,
      seatCount,
    });
  }

  async function seedActiveSeats(tenantId: string, trainerId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const clientId = await seedUser();
      await assignmentRepo.create(tenantId, trainerId, clientId, "active");
    }
  }

  it("countActiveByTrainer counts ONLY active assignments (invited/revoked excluded)", async () => {
    const tenantId = await seedTenant();
    const trainerId = await seedUser();

    // 2 active, 1 invited, 1 revoked → count must be 2.
    await seedActiveSeats(tenantId, trainerId, 2);
    await assignmentRepo.create(tenantId, trainerId, await seedUser(), "invited");
    await assignmentRepo.create(tenantId, trainerId, await seedUser(), "revoked");

    await expect(assignmentRepo.countActiveByTrainer(tenantId)).resolves.toBe(2);
  });

  it("countActiveByTrainer is 0 for a tenant with no active assignments", async () => {
    const tenantId = await seedTenant();
    const trainerId = await seedUser();
    await assignmentRepo.create(tenantId, trainerId, await seedUser(), "revoked");
    await expect(assignmentRepo.countActiveByTrainer(tenantId)).resolves.toBe(0);
  });

  it("syncSeats updates Stripe with the recomputed floored quantity + idempotency key", async () => {
    const tenantId = await seedTenant();
    const trainerId = await seedUser();
    await seedActiveSeats(tenantId, trainerId, 3);
    await seedStripeSponsor(tenantId, "sub_sync", null);

    const gateway: SubscriptionGateway = { updateSubscriptionQuantity: vi.fn(async () => undefined) };
    // Flag ON (16c v3 design.md Migration/Rollout gate) — this suite
    // exercises the real outbound-call behavior, which is now feature-flagged
    // off by default.
    const service = new SeatSyncService(seatSource, store, gateway, undefined, true);

    await service.syncSeats(tenantId);

    expect(gateway.updateSubscriptionQuantity).toHaveBeenCalledWith(
      "sub_sync",
      3,
      `seat-sync:${tenantId}:3`,
    );
  });

  it("syncSeats is a no-op for a tenant with no Stripe subscription", async () => {
    const tenantId = await seedTenant();
    const trainerId = await seedUser();
    await seedActiveSeats(tenantId, trainerId, 2);
    // Billing row exists but carries NO stripe subscription id.
    await seedStripeSponsor(tenantId, null, null);

    const gateway: SubscriptionGateway = { updateSubscriptionQuantity: vi.fn(async () => undefined) };
    const service = new SeatSyncService(seatSource, store, gateway, undefined, true);

    await service.syncSeats(tenantId);
    expect(gateway.updateSubscriptionQuantity).not.toHaveBeenCalled();
  });

  it("ADVERSARIAL: two concurrent syncSeats for the same sponsor SERIALIZE via the advisory lock and converge to the true count", async () => {
    const tenantId = await seedTenant();
    const trainerId = await seedUser();
    await seedActiveSeats(tenantId, trainerId, 4);
    await seedStripeSponsor(tenantId, "sub_race", null);

    let inFlight = 0;
    let maxInFlight = 0;
    const quantities: number[] = [];
    const gateway: SubscriptionGateway = {
      updateSubscriptionQuantity: vi.fn(async (_subId: string, quantity: number) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        quantities.push(quantity);
        // Hold the lock long enough that an UNSERIALIZED second caller would
        // overlap here — the advisory lock must prevent that.
        await delay(80);
        inFlight -= 1;
      }),
    };
    const service = new SeatSyncService(seatSource, store, gateway, undefined, true);

    await Promise.all([service.syncSeats(tenantId), service.syncSeats(tenantId)]);

    // The lock serialized the two outbound calls — they never overlapped.
    expect(maxInFlight).toBe(1);
    // Both recomputed the true active count (never a delta); Stripe converged on 4.
    expect(quantities).toEqual([4, 4]);
    expect(gateway.updateSubscriptionQuantity).toHaveBeenCalledTimes(2);
  });

  it("reconcileAllStaleSponsors reconciles ONLY drifted seat sponsors, skipping converged + non-seat tenants", async () => {
    // Drifted sponsor: 2 active seats, seat_count still null → desired 2 ≠ null.
    const driftedTenant = await seedTenant();
    const driftedTrainer = await seedUser();
    await seedActiveSeats(driftedTenant, driftedTrainer, 2);
    await seedStripeSponsor(driftedTenant, "sub_drift", null);

    // Converged sponsor: 1 active seat, seat_count already 1 → NOT drifted.
    const convergedTenant = await seedTenant();
    const convergedTrainer = await seedUser();
    await seedActiveSeats(convergedTenant, convergedTrainer, 1);
    await seedStripeSponsor(convergedTenant, "sub_ok", 1);

    // Zero-seat sponsor at the floor: 0 active, seat_count 1 → NOT drifted
    // (GREATEST(1,0)=1 matches seat_count 1).
    const zeroTenant = await seedTenant();
    const zeroTrainer = await seedUser();
    await assignmentRepo.create(zeroTenant, zeroTrainer, await seedUser(), "revoked");
    await seedStripeSponsor(zeroTenant, "sub_zero", 1);

    // Non-seat tenant: has assignments but NO stripe subscription → excluded.
    const nonSeatTenant = await seedTenant();
    const nonSeatTrainer = await seedUser();
    await seedActiveSeats(nonSeatTenant, nonSeatTrainer, 3);
    await seedStripeSponsor(nonSeatTenant, null, null);

    const seen: Array<{ subId: string; quantity: number }> = [];
    const gateway: SubscriptionGateway = {
      updateSubscriptionQuantity: vi.fn(async (subId: string, quantity: number) => {
        seen.push({ subId, quantity });
      }),
    };
    const service = new SeatSyncService(seatSource, store, gateway, undefined, true);

    const reconciled = await service.reconcileAllStaleSponsors();

    // The sweep is a GLOBAL drift scan, so a shared test DB may also surface
    // sponsors left drifted by earlier tests in this run. Assert on THIS test's
    // sponsors specifically: the drifted one is swept + resynced; the
    // converged, zero-seat-at-floor, and non-seat ones are NOT.
    expect(reconciled).toContain(driftedTenant);
    expect(reconciled).not.toContain(convergedTenant);
    expect(reconciled).not.toContain(zeroTenant);
    expect(reconciled).not.toContain(nonSeatTenant);
    expect(seen).toContainEqual({ subId: "sub_drift", quantity: 2 });
    const seenSubs = seen.map((s) => s.subId);
    expect(seenSubs).not.toContain("sub_ok");
    expect(seenSubs).not.toContain("sub_zero");
    // The non-seat tenant carries no subscription id, so it can never be synced.
    expect(seen.every((s) => s.subId !== null && s.subId !== "")).toBe(true);
  });
});

describe.skipIf(hasDb)("seat-sync (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
