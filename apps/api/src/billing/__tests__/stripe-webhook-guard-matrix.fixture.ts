/**
 * Shared guard-predicate matrix for the webhook out-of-order/idempotency
 * decision (#201). Both the pure-unit suite (`process-webhook.test.ts`) and
 * the real-Postgres integration suite (`stripe-webhook.integration.test.ts`)
 * drive the SAME matrix through, respectively, `shouldAcceptStoreWrite` and
 * the actual `INSERT ... ON CONFLICT DO UPDATE ... WHERE` upsert — so a
 * one-sided edit to either predicate deterministically fails a test instead
 * of silently drifting (see `stripe-events.ts` for why the two are kept in
 * sync manually).
 *
 * `tsRelation` describes the existing high-water mark's Stripe-event
 * timestamp relative to the incoming event:
 *   - "none"    — no billing-state row exists yet for the tenant
 *   - "null"    — a row exists but has no recorded Stripe timestamp (a
 *                 pre-Stripe 11a row)
 *   - "earlier" — the existing timestamp is strictly BEFORE the incoming one
 *   - "equal"   — same second (Stripe's `created` granularity) — the
 *                 terminal-state tie-break applies here
 *   - "later"   — the existing timestamp is strictly AFTER the incoming one
 */
export type GuardTsRelation = "none" | "null" | "earlier" | "equal" | "later";
export type GuardStatus = "active" | "expired";

export interface GuardMatrixCase {
  name: string;
  tsRelation: GuardTsRelation;
  /** Existing row's status. Irrelevant (and omitted) when `tsRelation` is "none". */
  existingStatus?: GuardStatus;
  incomingStatus: GuardStatus;
  /** Expected accept/reject decision — identical for the pure predicate and the real upsert. */
  expectAccept: boolean;
}

function relationCases(
  tsRelation: Exclude<GuardTsRelation, "none">,
  expectAccept: (existingStatus: GuardStatus, incomingStatus: GuardStatus) => boolean,
): GuardMatrixCase[] {
  const statuses: GuardStatus[] = ["active", "expired"];
  const cases: GuardMatrixCase[] = [];
  for (const existingStatus of statuses) {
    for (const incomingStatus of statuses) {
      cases.push({
        name: `${tsRelation} ts, existing ${existingStatus} -> incoming ${incomingStatus}`,
        tsRelation,
        existingStatus,
        incomingStatus,
        expectAccept: expectAccept(existingStatus, incomingStatus),
      });
    }
  }
  return cases;
}

export const GUARD_MATRIX: GuardMatrixCase[] = [
  // FIX 1: no existing row at all — correctness must not depend on a
  // pre-existing row. Always accepted regardless of the incoming status.
  { name: "no existing row -> incoming active accepted", tsRelation: "none", incomingStatus: "active", expectAccept: true },
  { name: "no existing row -> incoming expired accepted", tsRelation: "none", incomingStatus: "expired", expectAccept: true },

  // Existing row with a null Stripe timestamp (pre-Stripe 11a row) — always
  // accepted, regardless of either status.
  ...relationCases("null", () => true),

  // Strictly earlier existing timestamp — the incoming event is newer, always accepted.
  ...relationCases("earlier", () => true),

  // Strictly later existing timestamp — the incoming event is stale, always rejected.
  ...relationCases("later", () => false),

  // FIX 2: equal timestamp (same-second tie-break) — reject ONLY a
  // non-terminal (active) write over an existing terminal (expired) state.
  ...relationCases(
    "equal",
    (existingStatus, incomingStatus) => !(existingStatus === "expired" && incomingStatus === "active"),
  ),
];
