import type { SubscriptionGateway } from "./stripe-gateway.js";

// ---------------------------------------------------------------------------
// Seat-count source + sync orchestration (16c v3 B2B seat-based billing,
// Slice C — design.md Decision Q3).
//
// Pure use-case layer: this module NEVER imports drizzle/pg (architecture rule
// `api-no-db-outside-infra`). Everything DB-shaped — the per-sponsor advisory
// lock, the sponsor's `stripe_subscription_id` read, and the drift sweep query
// — is behind the injected `SponsorSeatStore` port, implemented by the infra
// adapter `db/repositories/seat-sync-store.ts`. The Stripe call is behind the
// existing `SubscriptionGateway` port (Slice A). The seat COUNT is behind the
// `SeatSource` port so a gym implementation can be added later (design Q2)
// without touching this orchestration.
// ---------------------------------------------------------------------------

/**
 * The seat-count source-of-truth abstraction (design Q2). `countActiveSeats`
 * returns the number of seats a sponsor tenant is currently consuming. Only a
 * TRAINER implementation ships here ({@link TrainerSeatSource}); the gym
 * implementation is deferred behind the 16b foundation, so the port exists but
 * is intentionally the only seam a gym source would later plug into.
 */
export interface SeatSource {
  countActiveSeats(tenantId: string): Promise<number>;
}

/**
 * Structural port for the trainer-assignment count query. Declared here (not
 * imported from `db/repositories`) so this pure module never depends on the DB
 * layer; the concrete `TrainerAssignmentRepository` satisfies it structurally,
 * wired in `app.ts`.
 */
export interface TrainerSeatCountSource {
  countActiveByTrainer(tenantId: string): Promise<number>;
}

/**
 * Trainer seat source: one active `trainer_client_assignments` row = one seat
 * (design Q2 — the explicit active/revoked lifecycle already matches seat
 * billing semantics). Backed by the repo's `countActiveByTrainer`.
 */
export class TrainerSeatSource implements SeatSource {
  constructor(private readonly repo: TrainerSeatCountSource) {}

  countActiveSeats(tenantId: string): Promise<number> {
    return this.repo.countActiveByTrainer(tenantId);
  }
}

/**
 * Infra port for the per-sponsor lock + sponsor metadata reads (design Q3).
 * Implemented by `db/repositories/seat-sync-store.ts`, which mirrors the
 * tier-override advisory-lock pattern (`pg_advisory_xact_lock(hashtext(...))`
 * inside a transaction).
 */
export interface SponsorSeatStore {
  /**
   * Run `work` while holding a transaction-scoped per-sponsor Postgres advisory
   * lock keyed by `tenantId`, so two concurrent seat syncs for the same sponsor
   * can never settle on a stale quantity (design Q3 — the LOCK is the race fix,
   * not the idempotency key). The sponsor's `stripeSubscriptionId` is read UNDER
   * the lock and handed to `work`; `null` means the tenant holds no Stripe
   * subscription (not a seat customer). The lock is released automatically when
   * the transaction commits/rolls back.
   */
  withSponsorLock<T>(
    tenantId: string,
    work: (sponsor: { stripeSubscriptionId: string | null }) => Promise<T>,
  ): Promise<T>;

  /**
   * Scheduled-sweep source (design Q3 reconcile trigger #2): the sponsor
   * tenants whose DB active-seat count and last-known persisted `seat_count`
   * disagree (accounting for the `max(1, count)` floor). These are the tenants
   * a failed outbound call left drifted; the sweep reconciles each.
   */
  findSponsorsWithSeatDrift(): Promise<string[]>;
}

/**
 * Optional sink for a swallowed outbound Stripe failure. Fire-and-forget log
 * hook — the failure is deliberately NOT propagated (see {@link SeatSyncService}).
 */
export type SeatSyncErrorSink = (tenantId: string, error: unknown) => void;

/**
 * Seat-sync orchestration (design Q3). One instance is shared by the assignment
 * trigger (routes/trainer.ts) and the scheduled reconcile sweep.
 *
 * Concurrency model: desired quantity is ALWAYS recomputed as
 * `countActiveSeats(tenantId)` (never a delta) and the recompute + outbound
 * Stripe update run UNDER the per-sponsor advisory lock, so the last writer
 * always settles Stripe on the true active count.
 *
 * Fail-safe: the assignment mutation is committed FIRST and separately (the
 * route awaits the DB write before calling here), so a Stripe failure never
 * rolls the assignment back and never fails the caller — DB desired-quantity is
 * simply ahead of Stripe until the reconcile sweep heals it.
 */
export class SeatSyncService {
  /**
   * @param seatSyncEnabled Feature flag gating the OUTBOUND Stripe mutation
   *   (16c v3 design.md "Migration/Rollout" — Judgment Day fix). The per-seat
   *   Stripe product (Slice E) is not live yet, so the only real subscriptions
   *   today are flat Pro subs; leaving this always-on would let a trainer
   *   admin override's accept/revoke mutate a tenant's unrelated Pro
   *   subscription quantity. DEFAULT OFF (mirrors the `VOICE_USE_MOCK`-style
   *   `=== "1"` env parsing in app.ts via `SEAT_BILLING_ENABLED`). When off,
   *   the DB recompute + advisory lock still run (harmless), but
   *   `gateway.updateSubscriptionQuantity` is NEVER called — a complete no-op
   *   on the Stripe side. Existing tests that assert the Stripe call happens
   *   must pass `true` explicitly.
   */
  constructor(
    private readonly seatSource: SeatSource,
    private readonly store: SponsorSeatStore,
    private readonly gateway: SubscriptionGateway,
    private readonly onError?: SeatSyncErrorSink,
    private readonly seatSyncEnabled: boolean = false,
  ) {}

  /**
   * Trigger entrypoint — fired on the assignment transitions that change the
   * active set (accept → active, revoke → revoked). Semantically identical to
   * {@link reconcileSeats}: the recompute is authoritative, so every trigger is
   * also an opportunistic reconcile (design Q3 reconcile trigger #1).
   */
  syncSeats(tenantId: string): Promise<void> {
    return this.resyncUnderLock(tenantId);
  }

  /** Reconcile a single sponsor: recompute under the lock + idempotent update. */
  reconcileSeats(tenantId: string): Promise<void> {
    return this.resyncUnderLock(tenantId);
  }

  /**
   * Scheduled-sweep entrypoint (design Q3 reconcile trigger #2). Finds every
   * sponsor whose DB active-count and last-known `seat_count` disagree and
   * reconciles each under its own per-sponsor lock. Returns the reconciled
   * tenant ids (for observability / test assertions).
   *
   * TRIGGERING: no in-app scheduler exists in `apps/api/src` today. This is the
   * minimal callable sweep the design mandates Slice C ship — wire it to a cron
   * by either (a) invoking `SeatSyncService.reconcileAllStaleSponsors()` from a
   * scheduled ops job/worker that boots the app's composition root, or (b)
   * exposing it behind a superadmin-only `POST /admin/seat-sync/reconcile`
   * route (mirroring `routes/admin-tier-override.ts`) hit by an external cron.
   * Left as an explicit ops decision (design Open Questions); the sweep itself
   * is complete and self-healing regardless of which trigger is chosen.
   */
  async reconcileAllStaleSponsors(): Promise<string[]> {
    const stale = await this.store.findSponsorsWithSeatDrift();
    const reconciled: string[] = [];
    for (const tenantId of stale) {
      await this.reconcileSeats(tenantId);
      reconciled.push(tenantId);
    }
    return reconciled;
  }

  private async resyncUnderLock(tenantId: string): Promise<void> {
    await this.store.withSponsorLock(tenantId, async ({ stripeSubscriptionId }) => {
      // No Stripe subscription ⇒ not a seat customer. Skip gracefully — never
      // throw (design Q3 ordering note).
      if (!stripeSubscriptionId) return;

      const count = await this.seatSource.countActiveSeats(tenantId);
      // Stripe rejects quantity 0 on a licensed recurring line item; the last
      // seat removed keeps the subscription at quantity 1 (design Q3 zero-seat).
      const quantity = Math.max(1, count);

      // Migration/Rollout gate (design.md, Judgment Day fix): the outbound
      // Stripe mutation is feature-flagged OFF by default until the per-seat
      // product ships (Slice E). The recompute above still runs (harmless —
      // it never mutates anything), but the call below is skipped entirely.
      if (!this.seatSyncEnabled) return;

      // Retry-safety only — the LOCK prevents the race, this key just makes the
      // single in-flight call safe to retry (design Q3 idempotency note).
      const idempotencyKey = `seat-sync:${tenantId}:${quantity}`;

      try {
        await this.gateway.updateSubscriptionQuantity(stripeSubscriptionId, quantity, idempotencyKey);
      } catch (error) {
        // Fail-safe: swallow so the (already-committed) assignment is never
        // rolled back and the caller never fails. Drift is healed by the
        // scheduled reconcile sweep (design Q3 reconcile).
        this.onError?.(tenantId, error);
      }
    });
  }
}
