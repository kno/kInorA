import type { BillingDenialReason } from "@kinora/contracts";
import type { BillingScope } from "./types.js";
import { resolveEffectiveTier, type EntitlementReaderPort } from "./entitlement.js";

/**
 * Result of a chat entitlement check. Mirrors the allow/deny shape of the other
 * billing gates but carries NO tier/period on allow — chat consumes no quota, so
 * there is nothing to meter. On denial the `reason` is the same
 * `BillingDenialReason` the route maps to a 403, exactly as confirm/regenerate do
 * (`plan.ts` → `reply.code(403).send({ error: decision.reason })`).
 */
export interface ChatEntitlementDecision {
  allowed: boolean;
  reason?: BillingDenialReason;
}

/**
 * Pro-only gate for the conversational create-plan chat endpoint
 * (12-interactive-text-chat, S2a).
 *
 * Mirrors `MemoryRetrievalEntitlementPort` (`memory-retriever.ts`) as a narrow
 * port so the route depends on an interface, not a concrete use case. Unlike the
 * quota gates it does NOT consume anything and adds NO entry to
 * `BILLING_FEATURES` — chat/extraction turns are explicitly quota-free (only the
 * existing confirm → generate step consumes `plan_generation`). The Pro gate
 * replaces a per-turn meter in v1.
 */
export interface ChatEntitlementPort {
  check(scope: BillingScope, now?: Date): Promise<ChatEntitlementDecision>;
}

/**
 * Tier-based chat gate. Allows only when the effective tier resolves to `pro`,
 * read server-side via `resolveEffectiveTier` from the entitlement context — the
 * SAME source of truth every other entitlement decision uses. The tenant/user
 * scope is always supplied by the route from `authContext`; this port has no
 * channel for a body-injected tenantId/tier, so a spoofed body cannot influence
 * the decision.
 *
 * Fail-closed, matching `CheckEntitlement.check`: an inactive membership or an
 * unresolved billing state denies BEFORE any tier resolution. A non-Pro tier
 * denies with its specific lapse reason (`trial_expired` / `subscription_ended`)
 * or `premium_required` for an always-Free tenant.
 */
export class ChatEntitlement implements ChatEntitlementPort {
  constructor(private readonly reader: EntitlementReaderPort) {}

  async check(scope: BillingScope, now: Date = new Date()): Promise<ChatEntitlementDecision> {
    const ctx = await this.reader.loadContext(scope);

    if (ctx.membershipStatus !== "active") {
      return { allowed: false, reason: "inactive_membership" };
    }

    if (!ctx.billing && !ctx.activeOverrideTier) {
      return { allowed: false, reason: "billing_state_unavailable" };
    }

    const effective = resolveEffectiveTier(ctx, now);
    if (effective.tier !== "pro") {
      return { allowed: false, reason: effective.lapsedReason ?? "premium_required" };
    }

    return { allowed: true };
  }
}
