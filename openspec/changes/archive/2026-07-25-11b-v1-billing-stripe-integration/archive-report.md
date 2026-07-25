# Archive Report: 11b-v1-billing-stripe-integration

## Status

- Artifact store: OpenSpec
- Task completion: 24/24 tasks complete across Phase 1–5 (`tasks.md`); no unchecked implementation tasks.
- Verification: `verify-report.md` (Slice 5 / final-slice report) — Type-check PASS, Build PASS, full `pnpm -r --if-present test:coverage` EXIT 0/PASS (contracts 58, domain 255, i18n 30, api 1047 passed +34 skipped, web 920 passed, 0 failed; web function coverage 90.69% ≥ threshold 90). 0 CRITICAL findings. One explicitly deferred item: the real-stack `/billing` runtime smoke (live checkout/portal redirect against a running API+Postgres+web stack) could not run locally because local podman was down for the whole feature; it is documented as a required CI/podman-up follow-up, not silently skipped.
- Review: Full 4R bounded review on every slice (payments hot path, per the tasks forecast) plus a whole-feature Judgment Day — all APPROVED. Per-slice fixes, all closed with RED→GREEN or safety-net evidence in `apply-progress.md`:
  - Slice 2 (webhook, hottest): 2 WARNING (out-of-order guard bypass on first insert; same-second timestamp tie restoring stale state) + 1 operational fail-safe gap (unconfigured deploy silently drops webhooks) + 2 readability items — all 5 fixed via TDD/refactor. A follow-up flaky-test fix (non-deterministic concurrent-race assertion in the real-PG integration test) was also closed post-confirmation-review.
  - Slice 3 (checkout/caps/coupons): 1 WARNING (unbounded Stripe SDK timeout risking ~80s checkout stalls under brownout) + 2 readability items — fixed (bounded client timeout + retry, spelling/comment fixes).
  - Slice 4 (portal/invoices): 1 WARNING (portal + invoice endpoints were any-member instead of owner-only — a non-owner could cancel the tenant's subscription or read owner PII in invoice links) + 2 SUGGESTION (untested infra invoice mapper; readability) — fixed via RED→GREEN owner-only authz gate reusing the existing quota-admin owner check, plus new mapper tests.
  - Slice 5 (web UI): 1 WARNING (duplicate/incorrect PlanHero meta tiles) + 1 SUGGESTION (dead support link) — fixed; plus a post-CI e2e locator fix (ambiguous "Pro" text match resolved with stable `data-testid`s) before merge.
  - Judgment Day (whole-feature, cross-slice): correction round applied and re-confirmed APPROVED (PR #194).
- Merge reference: PR #189 (Slice 1 — schema-first), PR #190 (Slice 2 — webhook/subscription lifecycle), PR #191 (Slice 3 — checkout/real caps/coupons), PR #192 (Slice 4 — Customer Portal/invoices), PR #193 (Slice 5 — web billing UI), PR #194 (Judgment Day correction), all merged to `main`.

## Source Artifacts Read

- `openspec/changes/11b-v1-billing-stripe-integration/proposal.md`
- `openspec/changes/11b-v1-billing-stripe-integration/exploration.md`
- `openspec/changes/11b-v1-billing-stripe-integration/design.md`
- `openspec/changes/11b-v1-billing-stripe-integration/design-reference-open-design.md`
- `openspec/changes/11b-v1-billing-stripe-integration/tasks.md`
- `openspec/changes/11b-v1-billing-stripe-integration/apply-progress.md`
- `openspec/changes/11b-v1-billing-stripe-integration/verify-report.md`
- `openspec/changes/11b-v1-billing-stripe-integration/specs/11b-v1-billing-stripe-integration/spec.md`
- `openspec/changes/11b-v1-billing-stripe-integration/specs/11a-v1-billing-plans-tiers/spec.md`

## Spec Sync

| Domain | Action | Details |
|---|---|---|
| `11b-v1-billing-stripe-integration` | Updated (canonical) | 3 modified requirements (Stripe Test Checkout — now monthly+annual/Stripe-hosted/tenant-bound; Webhook Subscription Updates — now idempotent+fail-closed+out-of-order-guarded with full lifecycle mapping; Coupon Support — now server-side pre-validation), 6 added requirements (Config-Driven Pricing, Metered Pro Caps Enforcement, Stripe Customer Portal, Invoice History, Web Billing Screen, Payment Security), 0 removed. Purpose statement expanded to cover portal/invoices/pricing/caps/web UI (previously checkout/webhook/coupons only). Design-copy-reconciliation and confirmable-values notes preserved verbatim from the delta as trailing Notes.|
| `11a-v1-billing-plans-tiers` | Updated | 1 modified requirement (Plan Tiers — source enum gains `stripe`; the provisional `1_000_000` Pro cap replaced by the confirmed finite metered caps `plan_generation` 500 / `plan_regeneration` 1000 / `memory_write` 50000 / `memory_retrieval` 200000; added the "Pro tier resolution unchanged by Stripe metadata" scenario; the "Stripe concepts excluded" scenario removed since 11a's billing state now legitimately carries the `stripe` source value written by 11b's webhook). All other 11a requirements (Trial Period, Billing State Visibility, Hybrid Tenant Quotas, Member Quota Administration, Safe Backfill, Admin Overrides, and the trailing owner/trainer-role note) preserved unchanged. |

## Warnings / Findings Preserved

- All per-slice 4R WARNING findings (Slice 2 out-of-order guard + fail-safe gap, Slice 3 SDK timeout, Slice 4 owner-only authz gap, Slice 5 PlanHero meta-tile bug) were fixed pre-merge with RED→GREEN or documented safety-net evidence in `apply-progress.md`; none remain open.
- Explicitly deferred, non-blocking: the live end-to-end `/billing` runtime smoke (real API+Postgres+web stack: tenant switch, checkout+portal redirect, EN/ES+a11y) was not run locally because local podman was down for the entire feature; it is covered instead by the web unit/component suite plus the real-Postgres CI `billing-integration` job for the DB-layer behaviors, and is flagged in `verify-report.md` as a required CI/podman-up follow-up before release sign-off.
- Slice 5's dead `/help/billing` support link was fixed by rendering it as a non-navigating disabled placeholder with an explicit `TODO(11b-followup)` marker (no real FAQ destination exists yet in the repo) — tracked as a documented follow-up, not a defect.
- A discovery (not a defect) from the Slice 5 e2e locator fix: the OD-redesigned `BillingScreen` no longer renders the two legacy 11a "trial ended" / "unlock Pro" blocks at all (their i18n keys still exist and pass parity, but nothing wires them into the new component); the OD `ProCard` upgrade CTA appears to be the intended single consolidated upgrade surface. Flagged for a maintainer follow-up decision on whether those i18n keys should be pruned; not silently changed.

## Archive Decision

Archive approved. Zero CRITICAL findings across all 4R and Judgment Day passes; every WARNING was fixed pre-merge with RED→GREEN or equivalent safety-net evidence, and the Judgment Day correction round was re-confirmed APPROVED (PR #194). All 24 implementation tasks are `[x]` and match the delivered code across PR #189–#194. The one explicitly deferred item (live runtime smoke, blocked by local podman being down) is documented as a CI/podman-up follow-up in `verify-report.md` and here, not silently dropped. No stale task-checkbox reconciliation was needed — `tasks.md` already reflected true completion state.
