import type { BillingCycle, BillingSource, BillingTier } from "@kinora/contracts";
import {
  StripeSignatureError,
  type StripeGateway,
  type StripeSubscriptionSnapshot,
  type StripeSubscriptionStatus,
  type StripeWebhookEvent,
} from "./stripe-gateway.js";
import type { ObservabilityLogger } from "../observability/event-logger.js";

/**
 * Pure webhook use case (11b-v1-billing-stripe-integration, Slice 2).
 *
 * Maps a verified Stripe subscription event onto the existing 11a
 * `status`/`tier` billing contract. `resolveEffectiveTier` (entitlement.ts)
 * remains the single source of truth and is UNCHANGED: this use case only ever
 * writes `status`/`tier` (`active`/`pro` or `expired`) plus additive Stripe
 * metadata. The additive stripe columns are never read by entitlement, and an
 * active admin override still wins at read time (it is resolved first, and this
 * writer never touches the overrides table).
 *
 * Correctness invariants (Threat Matrix + spec):
 *   - signature verify runs in the adapter; a `StripeSignatureError` (client
 *     fault — spoofed/tampered/missing signature) is mapped here to
 *     `invalid_signature` (route → 400, no write). A `StripeGatewayUnconfiguredError`
 *     (operator/server fault — Stripe env unset) is DELIBERATELY NOT caught
 *     here: it propagates (route → 5xx) so Stripe retries instead of the
 *     deployment silently dropping real billing events (4R resilience fix).
 *   - idempotency + the atomic out-of-order/same-second-tie-break guard live
 *     in the transactional store adapter (see {@link shouldAcceptStoreWrite})
 *   - fail-closed: any OTHER store/gateway error propagates (route → 5xx); Pro
 *     is NEVER granted or retained on a failure
 */

/** The billing-state row the webhook writes. `source` is always `stripe`. */
export interface BillingStateWrite {
  tenantId: string;
  tier: BillingTier;
  status: "active" | "expired";
  source: BillingSource;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeSubscriptionStatus: string;
  billingCycle: BillingCycle | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /**
   * 16c-v3-b2b-seat-billing Slice B: mirrors the Stripe subscription's item
   * quantity (`StripeSubscriptionSnapshot.seatQuantity`) as-is. NO price→tier
   * mapping happens here — `tier` stays "pro" (Decision Q5); the trainer/gym
   * tier is granted only by the 16d admin override.
   */
  seatCount: number | null;
}

export interface RecordEventInput {
  eventId: string;
  type: string;
  /** Ordering key for the out-of-order guard (Stripe event `created`). */
  eventTs: Date;
  write: BillingStateWrite;
}

/**
 * `processed` — the event was recorded and the billing state applied.
 * `duplicate` — the event id was already processed; no side effect (exactly-once).
 * `stale` — an older, out-of-order event; recorded but state NOT regressed.
 * `unknown_tenant` — the event's `tenantId` has no row in `tenants` (#290,
 *   e.g. a checkout whose tenant was later deleted). This is a PERMANENT
 *   condition, not a transient failure: the idempotency row is still recorded
 *   (so Stripe stops retrying), but the billing-state write is skipped
 *   entirely (it would otherwise violate the `tenants` FK and 5xx forever).
 */
export type RecordEventOutcome =
  | { outcome: "processed" }
  | { outcome: "duplicate" }
  | { outcome: "stale" }
  | { outcome: "unknown_tenant" };

/**
 * Transactional store port. The adapter MUST run steps atomically:
 *   1. insert `stripe_processed_events` on-conflict-do-nothing (idempotency);
 *      a conflict → `duplicate`, no write
 *   2. upsert the tenant billing state guarded by {@link shouldAcceptStoreWrite}
 *      encoded DIRECTLY in the `INSERT ... ON CONFLICT DO UPDATE ... WHERE`
 *      clause (never a separate read-then-decide step — see the adapter for
 *      why); a rejected write → `stale`, no regression
 * Any failure MUST roll the whole thing back so Stripe safely retries.
 */
export interface StripeEventStorePort {
  recordEventAndApply(input: RecordEventInput): Promise<RecordEventOutcome>;
}

/**
 * Structured, PII-free log line (tenantId + event type/id ONLY — never
 * secrets or payload) for observability when a paid webhook arrives for a
 * tenant that no longer exists — worth surfacing even though it is
 * acknowledged rather than retried (#290).
 */
function logUnknownTenant(tenantId: string, eventType: string, eventId: string): void {
  console.warn("[billing:webhook] event for unknown tenant — acknowledged, no billing write", {
    tenantId,
    eventType,
    eventId,
  });
}

/** The tenant's currently stored high-water mark, or `null` when no row exists yet. */
export interface StoredWriteHighWaterMark {
  stripeEventTs: Date | null;
  status: "active" | "expired";
}

/**
 * Pure predicate mirroring the store adapter's atomic conditional-upsert
 * `WHERE` clause (`db/repositories/stripe-events.ts`): whether an incoming
 * write should be ACCEPTED against the tenant's currently stored high-water
 * mark. Kept here so the exact guard semantics are unit-testable without a
 * real Postgres — the SQL `WHERE` clause MUST stay logically equivalent (the
 * real-Postgres integration suite asserts this end-to-end).
 *
 * Rules (4R resilience/reliability fixes):
 *   - no existing row, or an existing row with no recorded Stripe event yet
 *     (a pre-Stripe 11a row) → ALWAYS accept. Correctness must never depend on
 *     a row already existing (fixes the first-insert-window bypass: two
 *     concurrent first-time deliveries for a brand-new tenant used to both
 *     pass a `SELECT ... FOR UPDATE` that locked NOTHING on a non-existent
 *     row, letting an older event that committed last silently win).
 *   - a strictly OLDER incoming event → reject (the standard out-of-order guard).
 *   - a strictly NEWER incoming event → accept.
 *   - an EQUAL timestamp (Stripe's `created` is second-granularity, so two
 *     distinct events can legitimately share a second) → reject ONLY a
 *     non-terminal (`active`) write that would overwrite an already-stored
 *     terminal (`expired`) state; every other equal-timestamp pairing accepts
 *     (idempotent same-status rewrites, and a terminal write always may
 *     overwrite a non-terminal one).
 */
export function shouldAcceptStoreWrite(
  existing: StoredWriteHighWaterMark | null,
  incoming: { stripeEventTs: Date; status: "active" | "expired" },
): boolean {
  if (!existing || existing.stripeEventTs === null) return true;

  const existingTs = existing.stripeEventTs.getTime();
  const incomingTs = incoming.stripeEventTs.getTime();
  if (incomingTs < existingTs) return false;
  if (incomingTs > existingTs) return true;

  // Equal timestamp: same-second tie-break — a stored terminal state must
  // never be regressed by a same-second non-terminal write.
  return !(existing.status === "expired" && incoming.status === "active");
}

/**
 * `ignored` covers both a signed event with no actionable subscription/tenant
 * AND a store-reported `unknown_tenant` (#290) — both acknowledge (route →
 * 200) with no billing write.
 */
export type ProcessWebhookResult =
  | { status: "ok"; outcome: "processed" | "duplicate" | "stale" | "ignored" }
  | { status: "invalid_signature" };

/** Statuses that map to a retained Pro entitlement. `past_due` is grace. */
const ENTITLED_STATUSES: ReadonlySet<StripeSubscriptionStatus> = new Set<StripeSubscriptionStatus>([
  "active",
  "trialing",
]);
const GRACE_STATUSES: ReadonlySet<StripeSubscriptionStatus> = new Set<StripeSubscriptionStatus>([
  "past_due",
]);

/**
 * Resolve the billing `status` a subscription snapshot maps to. Fail-closed:
 * a `customer.subscription.deleted` event, a terminal status, or any unknown
 * status reconciles to `expired`. An entitled subscription scheduled to cancel
 * at period end stays `active` until `current_period_end`, then expires.
 */
export function resolveBillingStatus(
  eventType: string,
  sub: StripeSubscriptionSnapshot,
  now: Date,
): "active" | "expired" {
  if (eventType === "customer.subscription.deleted") return "expired";

  if (ENTITLED_STATUSES.has(sub.status)) {
    if (
      sub.cancelAtPeriodEnd &&
      sub.currentPeriodEnd &&
      now.getTime() >= sub.currentPeriodEnd.getTime()
    ) {
      return "expired";
    }
    return "active";
  }

  // Grace: Stripe is still retrying the renewal — keep Pro until it either
  // recovers (→ active) or gives up (→ a canceled/unpaid/deleted event → expired).
  if (GRACE_STATUSES.has(sub.status)) return "active";

  // canceled / unpaid / incomplete / incomplete_expired / paused / unknown.
  return "expired";
}

/** Map a verified event + subscription snapshot to the billing-state write. */
export function mapSubscriptionToWrite(
  event: StripeWebhookEvent,
  sub: StripeSubscriptionSnapshot,
  now: Date,
): BillingStateWrite {
  const status = resolveBillingStatus(event.type, sub, now);
  return {
    tenantId: sub.tenantId as string,
    tier: "pro",
    status,
    source: "stripe",
    stripeCustomerId: sub.stripeCustomerId,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    stripeSubscriptionStatus: sub.status,
    billingCycle: sub.cycle,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    // 16c Slice B (Q5): no price→tier mapping — `tier` above stays "pro".
    // Persist the observed Stripe quantity as-is; the 16d admin override is
    // the sole source of the trainer/gym TIER.
    //
    // 16c Slice F (design "Downgrade / lapse behavior"): a canceled/deleted
    // Stripe subscription object can still report its last-known item
    // quantity — `seatQuantity` alone is NOT trustworthy once the write
    // resolves to `expired`. Zero it here so a lapsed sponsor's seatCount
    // never lingers to inflate `resolveTenantFeatureLimit`'s seat-scaled
    // formula (`max(base, seatCount × Pro)`) after billing has ended.
    seatCount: status === "expired" ? null : sub.seatQuantity,
  };
}

export class ProcessStripeWebhook {
  constructor(
    private readonly gateway: StripeGateway,
    private readonly store: StripeEventStorePort,
    /**
     * Optional observability seam (#310). Records a PII-free `billing.webhook`
     * event (ids + outcome + event type ONLY) for EVERY resolved outcome —
     * previously only `unknown_tenant` was surfaced (via the console warn
     * above). Fire-and-forget: `recordEvent` never throws or blocks, so it can
     * never break webhook processing. Absent in unit tests that don't assert it.
     */
    private readonly observability?: ObservabilityLogger,
  ) {}

  /**
   * Verify, map, and idempotently apply a raw Stripe webhook delivery.
   * Returns `invalid_signature` for a spoofed/tampered/unsigned request (route
   * → 400, no write). Any OTHER error propagates so the route returns 5xx and
   * Stripe retries — Pro is never granted on failure (fail-closed).
   */
  async process(
    rawBody: Buffer | string,
    signature: string | undefined,
    now: Date = new Date(),
  ): Promise<ProcessWebhookResult> {
    let event: StripeWebhookEvent;
    try {
      event = this.gateway.verifyAndParseEvent(rawBody, signature);
    } catch (error) {
      if (error instanceof StripeSignatureError) {
        return { status: "invalid_signature" };
      }
      // A non-signature error must NOT be swallowed — propagate → 5xx.
      throw error;
    }

    const sub = event.subscription;
    if (!sub || !sub.tenantId) {
      // No actionable subscription/tenant in the signed payload — acknowledge
      // with no billing write. A retry safely re-evaluates to the same no-op.
      this.recordWebhookEvent(null, "ignored", event, "info");
      return { status: "ok", outcome: "ignored" };
    }

    const write = mapSubscriptionToWrite(event, sub, now);
    const result = await this.store.recordEventAndApply({
      eventId: event.id,
      type: event.type,
      eventTs: event.eventTs,
      write,
    });
    if (result.outcome === "unknown_tenant") {
      // Recorded for idempotency by the store; a paid checkout webhook
      // arriving for a tenant that no longer exists is worth surfacing even
      // though it's a permanent, non-retryable condition (#290).
      logUnknownTenant(write.tenantId, event.type, event.id);
      this.recordWebhookEvent(write.tenantId, "unknown_tenant", event, "warn");
      return { status: "ok", outcome: "ignored" };
    }
    // processed / duplicate / stale — all previously unlogged.
    this.recordWebhookEvent(write.tenantId, result.outcome, event, "info");
    return { status: "ok", outcome: result.outcome };
  }

  /**
   * Emit a curated, PII-free `billing.webhook` observability event. Carries ONLY
   * the tenant id, the resolved outcome, and the Stripe event id/type — never
   * any payload, customer detail, or secret. Fire-and-forget via the logger.
   */
  private recordWebhookEvent(
    tenantId: string | null,
    outcome: "processed" | "duplicate" | "stale" | "ignored" | "unknown_tenant",
    event: StripeWebhookEvent,
    level: "info" | "warn",
  ): void {
    this.observability?.recordEvent({
      tenantId,
      level,
      event: "billing.webhook",
      outcome,
      metadata: { eventId: event.id, eventType: event.type },
    });
  }
}
