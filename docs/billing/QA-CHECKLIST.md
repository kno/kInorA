# Billing UI — QA checklist (issue #179)

Durable QA coverage for the `/billing` page. Most states are proven automatically
by the Playwright spec `tests/e2e/billing-visibility.spec.ts` (real API + Next.js +
Postgres). This checklist covers the scenarios that CANNOT be driven deterministically
by that harness — they need a DB-seeded billing state (a fresh registration is always
Pro/`trialing`) or a server-side fetch failure that the browser cannot force.

## Coverage map

| State / behavior                                   | Where it is proven                                            |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Pro trial tier + status + trial badge + empty usage | Automated — `billing-visibility.spec.ts` (happy path)        |
| Error card + retry                                 | Automated — `billing-visibility.spec.ts` (unauthenticated)   |
| Session-reissue refresh replaces prior state       | Automated — `billing-visibility.spec.ts` (retry after login) |
| Loading card                                       | Component test `BillingPageClient.test.tsx` + manual step 5  |
| Offline card                                       | Component test `BillingPageClient.test.tsx` + manual step 6  |
| Free tenant rendering (usage limits / no badge)    | Manual step 2 (needs DB-seeded Free tenant)                  |
| Trial-expired block + upgrade prompt               | Manual step 3 (needs DB-seeded expired trial)                |
| Non-empty usage rows                               | Manual step 4 (needs consumed quota)                         |
| Visual Free↔Pro replace-not-merge on tenant switch | Manual step 7 (needs two distinct tenants)                   |

## 0. Bring up the stack

Two options.

### Option A — full e2e harness (ephemeral Postgres on port 5433)

```bash
# From the repo root. Boots Postgres 17 in podman/docker, migrates, then runs
# Playwright. Leave it running, or run only the billing spec:
pnpm test:e2e tests/e2e/billing-visibility.spec.ts
```

The ephemeral DB is reachable at
`postgres://kinora:kinora@localhost:5433/kinora` (override the port with
`E2E_PG_PORT`). The container is named `kinora-e2e-pg`.

### Option B — long-lived dev stack (for manual clicking)

```bash
# 1. Start Postgres (any local instance works; the repo's compose file is fine):
podman compose up -d db        # or: docker compose up -d db

# 2. Point the API at it and migrate:
export DATABASE_URL="postgres://kinora:kinora@localhost:5432/kinora"
pnpm --filter api db:migrate

# 3. Build the workspace libs the web/api dev servers import from dist/:
pnpm --filter @kinora/contracts --filter @kinora/domain --filter @kinora/i18n build

# 4. Start API (:4000) and web (:3000):
pnpm dev
```

Open http://127.0.0.1:3000/sign-up and register a user; you land authenticated.

## Seeding helpers

A `psql` shell against the ephemeral e2e DB:

```bash
podman exec -it kinora-e2e-pg psql -U kinora -d kinora
# (docker exec ... for Docker)
```

Every registration provisions a Pro/`trialing` 30-day trial. To reshape a
specific tenant's billing state, target it by the member's email:

```sql
-- Make the tenant of user <email> a FREE / active tenant (manual step 2).
UPDATE tenant_billing_states s
SET tier = 'free', status = 'active', source = 'backfill',
    trial_started_at = NULL, trial_ends_at = NULL, updated_at = now()
FROM memberships m JOIN users u ON u.id = m.user_id
WHERE m.tenant_id = s.tenant_id AND u.email = '<email>';

-- Make the tenant's trial EXPIRED (manual step 3): keep status 'trialing'
-- but move the trial window into the past. The effective tier resolves to
-- free with denialReason = 'trial_expired'.
UPDATE tenant_billing_states s
SET trial_started_at = now() - interval '31 days',
    trial_ends_at   = now() - interval '1 day', updated_at = now()
FROM memberships m JOIN users u ON u.id = m.user_id
WHERE m.tenant_id = s.tenant_id AND u.email = '<email>';
```

After any DB change, click the in-page **Retry** button or switch tabs and back
(the client refreshes on focus/visibilitychange) — no full reload needed.

## Manual steps

Register a fresh user for each scenario (or reuse one and reseed via SQL).

### 1. Pro trial (sanity — also automated)
- Register a new user, open `/billing`.
- Expect: **Pro**, **Trial**, a **"Pro trial — N days left"** badge, and
  **"No usage recorded yet"**. No "trial ended" block, no upgrade prompt.

### 2. Free tenant
- Seed the tenant to Free/active (SQL above), refresh `/billing`.
- Expect: **Free** tier, **Active** status, **no** trial badge.
- Expect the **upgrade prompt** ("Unlock Pro features" + "View upgrade
  options"), because the Free tier's premium `memory_write` limit is 0.

### 3. Trial expired
- Seed the tenant's trial into the past (SQL above), refresh `/billing`.
- Expect the **"Your Pro trial has ended"** block AND the **upgrade prompt**.
- Expect the trial badge is **not** shown (an expired trial is not an active
  unexpired trial).

### 4. Non-empty usage
- As a Pro-trial or Free tenant, consume quota (e.g. generate a plan via
  `/create-plan`, which calls the billed `plan_generation` feature).
- Refresh `/billing`.
- Expect the empty-usage card is replaced by **"Tenant usage this period"** and
  **"Your usage this period"** lists, each with a row like
  `Plan generations — 1/1 used`.

### 5. Loading card
- Loading only shows on a client refresh while there is no data yet (the initial
  server render already carries data). To observe it, throttle the network in
  DevTools to "Slow 3G", then trigger a refresh (tab focus) from the error state.
- Expect the **"Loading your billing…"** card with an accessible progressbar.
- (Deterministically covered by `BillingPageClient.test.tsx`.)

### 6. Offline card
- The offline card requires the client to have recorded `api_unreachable` while
  `navigator.onLine` is false. Reproduce via DevTools: go offline, then trigger
  a refresh from the error state.
- Expect the **"You are offline"** card with a Retry button.
- (Deterministically covered by `BillingPageClient.test.tsx`.)

### 7. Tenant-switch replace-not-merge (visual)
- There is **no tenant-switcher UI**. Switching the active tenant = issuing a
  new `kinora_session`. Seed tenant A to Free (step 2) and keep tenant B as a
  Pro trial.
- Log in as A, open `/billing`, confirm the **Free** state (no badge, upgrade
  prompt). Then replace the session cookie with B's token (DevTools →
  Application → Cookies, or re-login as B in the same tab) and switch focus back
  to the tab.
- Expect the page to show **only** B's Pro-trial state — the Free tier / upgrade
  prompt from A must be fully gone (replaced, never merged).

## Notes / findings

- `/billing` is intentionally reachable while unauthenticated (it is not in the
  proxy's `PROTECTED_PATH_PREFIXES`); the page then renders its own error card
  instead of redirecting to `/login`. If product wants a redirect instead, add
  `/billing` to `PROTECTED_PATH_PREFIXES` in `apps/web/src/proxy.ts`.
- The billing read runs server-side (RSC + Server Action), so `page.route`
  browser interception cannot force the API error/timeout — hence the
  loading/offline cards are validated at the component-test level, not e2e.
