import type { Database } from "../db/client.js";
import { TrainerAssignmentRepository } from "../db/repositories/trainer-assignment.js";
import { SeatSyncStore } from "../db/repositories/seat-sync-store.js";
import { createStripeGatewayFromEnv } from "../db/repositories/stripe-gateway.js";
import { resolveTrainerSeatPriceIds } from "./pricing-config.js";
import {
  SeatSyncService,
  TrainerSeatSource,
  type SeatSyncErrorSink,
  type SponsorSeatStore,
  type TrainerSeatCountSource,
} from "./seat-sync.js";
import type { SubscriptionGateway } from "./stripe-gateway.js";

/**
 * Dependencies for {@link buildSeatSyncService}. Every field is optional so a
 * caller that already holds a shared instance (app.ts reuses
 * `trainerAssignmentRepo` for `trainerRoutes`/`planRoutes`, and
 * `realStripeGateway` for checkout/portal/webhook) can inject it instead of
 * paying for a second one; a standalone caller (the cron ops script) can pass
 * only `database` + `env` and let the factory build everything from scratch.
 */
export interface SeatSyncFactoryDeps {
  /** The Drizzle client. Required — every piece below is built from it unless overridden. */
  database: Database;
  /** Env bag to resolve `SEAT_BILLING_ENABLED` + the Trainer Seat Price ids from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Reuse an existing seat-count source (structurally satisfied by
   * `TrainerAssignmentRepository`) instead of constructing a fresh one from
   * `database`.
   */
  trainerAssignmentRepo?: TrainerSeatCountSource;
  /**
   * Reuse an existing Stripe adapter that implements {@link SubscriptionGateway}
   * (app.ts's `realStripeGateway`) instead of building one from env via
   * `createStripeGatewayFromEnv`. When neither is available (Stripe env unset
   * and no override), the outbound call fails closed with a thrown error —
   * matching app.ts's existing `seatSyncSubscriptionGateway` fallback. Never
   * actually reached while `SEAT_BILLING_ENABLED` is off, since the recompute
   * short-circuits before the outbound call.
   */
  stripeGateway?: SubscriptionGateway;
  /**
   * Reuse an existing `SponsorSeatStore` (e.g. a fake in tests) instead of
   * constructing a fresh `SeatSyncStore(database)`. Real callers (app.ts, the
   * cron script) never override this — it exists so this factory itself can
   * be unit-tested without a real Postgres advisory lock.
   */
  store?: SponsorSeatStore;
  /** Fire-and-forget sink for a swallowed outbound Stripe failure (see `SeatSyncService`). */
  onError?: SeatSyncErrorSink;
}

/**
 * The SINGLE composition path for `SeatSyncService` (16c v3 Slice C follow-up
 * — cron reconcile sweep). Extracted from `app.ts` so the running server AND
 * the standalone ops entrypoint (`scripts/reconcile-seats.mjs`) build the
 * EXACT same wiring — same feature-flag read, same seat-price guard, same
 * fail-closed gateway fallback — and can never drift from each other.
 */
export function buildSeatSyncService(deps: SeatSyncFactoryDeps): SeatSyncService {
  const env = deps.env ?? process.env;

  const trainerAssignmentRepo =
    deps.trainerAssignmentRepo ?? new TrainerAssignmentRepository(deps.database);

  const stripeGateway: SubscriptionGateway =
    deps.stripeGateway ??
    createStripeGatewayFromEnv(env) ?? {
      async updateSubscriptionQuantity() {
        throw new Error("stripe unconfigured — seat sync unavailable");
      },
    };

  // Migration/Rollout gate (design.md, Judgment Day fix): the outbound Stripe
  // quantity mutation is feature-flagged OFF by default until the per-seat
  // Stripe product (Slice E) ships — parsed identically to app.ts's own read.
  const seatBillingEnabled = env["SEAT_BILLING_ENABLED"] === "1";

  // SEAT-PRICE GUARD (fix/seat-sync-price-guard): only the configured Trainer
  // Seat Stripe Price ids that are actually set. Empty ⇒ every outbound call
  // is a no-op, the correct fail-closed default.
  const trainerSeatPriceIds = resolveTrainerSeatPriceIds(env);
  const seatPriceIds: readonly string[] = [
    trainerSeatPriceIds.trainerSeatMonthly,
    trainerSeatPriceIds.trainerSeatAnnual,
  ].filter((id): id is string => id !== undefined);

  return new SeatSyncService(
    new TrainerSeatSource(trainerAssignmentRepo),
    deps.store ?? new SeatSyncStore(deps.database),
    stripeGateway,
    deps.onError,
    seatBillingEnabled,
    seatPriceIds,
  );
}
