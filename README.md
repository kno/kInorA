# kInorA

Personalized training powered by **A**rtificial **I**ntelligence.

> 🇪🇸 [Versión en español](./README_ES.md)

kInorA generates and adapts training plans tailored to each user — goals, level, available equipment, and physical limitations — through two interaction modes: a visual card wizard and a conversational voice assistant. The system learns from the user's actual progress session by session and adjusts the plan continuously.

---

## a. Overview

kInorA is a platform composed of a **web app**, a **native mobile app**, and an **API** with an AI engine at the product's core. Its distinguishing features:

- **Plan definition in two modes**: cards (fast, visual) or conversational with voice (natural, nuanced). Both modes feed the same data structure, so the user can switch between them without losing progress.
- **Physical limitation adaptation**: the user declares injuries, chronic conditions, or mobility limitations, and the AI filters, substitutes, or adjusts exercises accordingly — always as a suggestion, never as a medical diagnosis. Limitation text is masked before it reaches any observability trace.
- **Available equipment adaptation**: the plan respects what the user has access to (full gym, limited home equipment, or nothing). If an exercise turns out to be unfeasible after plan generation, it is automatically replaced with an equivalent.
- **Persistent user memory**: structured memory plus vector memory over pgvector. The AI remembers preferences, equipment, context, and behavior patterns between sessions. The user can view, edit, and delete this memory.
- **Offline-first workout tracking**: set logging with a three-state flow (below / met / above) optimized for gym use, with automatic sync when connectivity is restored.
- **Swappable AI providers**: generation, speech-to-text, and text-to-speech each sit behind a port. The active provider is an operational decision, not a code change.
- **Freemium model with trial**: functional free tier, 30-day Pro trial with no credit card required, and a coupon system for campaigns and referrals.

---

## b. Tech Stack

| Layer | Technology |
| --- | --- |
| Web | Next.js 16 (App Router) + React 19 + TypeScript |
| Web PWA / offline | Serwist service worker, IndexedDB via `idb` |
| Mobile | React Native 0.79 + Expo 53 (`apps/mobile`). A Capacitor Android shell wrapping the web build also exists at the repository root. |
| API | Fastify 5 + Node.js 24 |
| Database | PostgreSQL 17 with the `pgvector` extension |
| ORM | Drizzle |
| Authentication | In-house implementation in the API: email/password with password policy and hashing, Google OIDC through `openid-client`, cookie-based sessions, automatic account linking by email |
| LLM orchestration | LangChain (`@langchain/core`) with JSON-schema structured output |
| Default LLM provider | OpenRouter (`OPENROUTER_MODEL`, e.g. `openai/gpt-4o-mini`) |
| Selectable LLM providers | OpenAI, Anthropic, Google Generative AI, OpenCode-Go — switchable at runtime from `/admin/ai-config` |
| Prompt management & LLM observability | Langfuse — remote versioned prompts under the `production` label, tracing, sensitive-data redaction, template-drift detection |
| Speech-to-Text | OpenAI (default), Gemini or Deepgram, selected via `VOICE_STT_PROVIDER` |
| Text-to-Speech | OpenAI (default), Gemini or Deepgram, selected via `VOICE_TTS_PROVIDER` |
| Payments & subscriptions | Stripe |
| Internationalization | `next-intl` (web), `react-intl` (mobile), shared catalogs in `packages/i18n` |
| Asset storage | Object-storage port with a local filesystem adapter on the VPS |
| Repository | Monorepo — pnpm workspaces |
| Infrastructure | Docker and Docker Compose on a VPS; multi-arch images published to GHCR |
| CI/CD | GitHub Actions |

There is no transactional email provider wired in yet. See [Next steps](#g-next-steps).

---

## c. Installation and Execution

### Prerequisites

- Node.js ≥ 24.17.0 (see `.node-version`)
- pnpm 10.17.1 (pinned via `packageManager`; `corepack enable` is enough)
- Docker and Docker Compose
- An OpenRouter API key for AI plan generation (not needed to run the unit tests, which use `MockPlanGenerator`)
- Google OAuth credentials for sign-in
- Optional: Langfuse keys for prompt management and tracing, Deepgram keys for voice, Stripe test keys for billing

### Setup

1. Clone the repository:

   ```bash
   git clone git@github.com:kno/kInorA.git
   cd kInorA
   ```

2. Install monorepo dependencies:

   ```bash
   pnpm install
   ```

3. Copy the example environment file and fill in the values. There is a **single** `.env` at the repository root; the apps do not carry their own:

   ```bash
   cp .env.example .env
   ```

   The full variable reference lives in [`apps/api/README.md`](./apps/api/README.md), which documents which variables are required, which are per-provider, and which are safe to omit.

4. Start the local database:

   ```bash
   docker compose up -d postgres
   ```

   The checked-in image is `pgvector/pgvector:pg17` because the vector-memory migration runs `CREATE EXTENSION vector`. A plain `postgres:*` image will fail that migration.

5. Run migrations:

   ```bash
   pnpm --filter api db:migrate
   ```

   For vector memory, keep `VECTOR_MEMORY_EMBEDDING_MODEL` and `VECTOR_MEMORY_EMBEDDING_DIMENSION` aligned with the embeddings already stored in Postgres (`text-embedding-3-small` / `1536` by default in Compose). Changing those values without re-embedding creates an incompatible cohort that the API will intentionally skip during retrieval.

   Current rollback boundary: to disable vector-memory writes and retrieval without taking the API down, unset `OPENAI_API_KEY` so the embedding boundary fails open while the rest of plan generation keeps working. Do not remove `CREATE EXTENSION vector` from the migration and do not swap the Postgres image.

That is everything a local run needs. The exercise catalog ships inside `packages/exercise-catalog` and its thumbnails are self-hosted under `apps/web/public/exercises/`, so there is no seeding step.

To refresh the catalog from the upstream dataset and re-mirror its media, run the maintenance script:

```bash
pnpm import:exercise-catalog
```

It rebuilds the catalog data and assets from the pinned upstream dataset. It does not touch the database.

### Development Execution

Start web and API in parallel (workspace packages are built first):

```bash
pnpm dev
```

- Web available at `http://localhost:3000`
- API available at `http://localhost:4000`

To run only one workspace:

```bash
pnpm --filter web dev
pnpm --filter api dev
```

The mobile app runs through Expo:

```bash
pnpm --filter mobile start
```

### Quality gates

The same checks CI runs, and the ones the `pre-push` hook enforces locally:

```bash
pnpm type-check
pnpm test
pnpm architecture     # dependency-cruiser + negative architecture test
pnpm deps-guard
pnpm ui-api-guard
pnpm build
pnpm test:e2e         # Playwright, boots its own stack
```

### Production Build

```bash
pnpm build
```

### Deployment

Deployment is automated in `.github/workflows/ci-cd.yml` and runs on push to `main`. The pipeline has six stages:

1. **CI** — type-check, unit and integration tests, and the architecture, dependency and UI/API guards.
2. **Billing integration** — the Stripe-facing suite against a real PostgreSQL instance.
3. **Docker smoke** — builds the image and verifies it boots.
4. **Build image** — multi-arch build across a runner matrix.
5. **Merge manifest** — publishes the combined multi-arch manifest to GHCR.
6. **Deploy** — connects to the VPS over SSH and rolls the new image out with Docker Compose.

The deploy step passes its configuration as a base64-encoded payload to avoid shell injection through the SSH command line, and pins the host key from `VPS_KNOWN_HOSTS` instead of trusting on first use. Pipeline-managed variables (image reference, OAuth credentials, API base URL) take precedence over the operator `.env`, so a stale value left on the server can never make a green deploy run an old image.

The operator `.env` holds the runtime secrets (`OPENROUTER_*`, `LANGFUSE_*`, `DEEPGRAM_*`, `STRIPE_*`, optional `POSTGRES_*`), lives only on the VPS, is never shipped by CI, and survives across deploys. Pipeline credentials are managed as GitHub Actions Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, and optionally `VPS_PORT`, `VPS_DEPLOY_DIR` and `PRODUCTION_BASE_URL`.

---

## d. Project Structure

```
kInorA/
├── apps/
│   ├── api/                     # Fastify — business logic and endpoints
│   │   └── src/
│   │       ├── routes/          # REST endpoints
│   │       ├── ai/              # LLM, STT and TTS ports and adapters, Langfuse
│   │       ├── auth/            # Sessions, credentials, Google OIDC, tenant selection
│   │       ├── billing/         # Stripe, tiers, coupons, seats
│   │       ├── plan/            # Plan generation and management
│   │       ├── user-memory/     # Structured and vector memory
│   │       ├── tenant/          # Tenant isolation
│   │       ├── branding/        # White label
│   │       ├── observability/   # Traces and operational events
│   │       ├── storage/         # Object-storage port and local adapter
│   │       ├── ws/              # WebSocket
│   │       └── db/              # Drizzle schema, migrations and repositories
│   │
│   ├── web/                     # Next.js — landing, private area, admin panel
│   └── mobile/                  # React Native + Expo
│
├── packages/
│   ├── contracts/               # Shared API contracts and Zod validation
│   ├── domain/                  # Enterprise rules — no framework, UI, DB or network
│   ├── exercise-catalog/        # Exercise catalog
│   └── i18n/                    # Shared message catalogs
│
├── android/                     # Capacitor Android shell
├── docs/                        # Project documentation
├── openspec/                    # Specs and archived changes — source of truth
├── scripts/                     # Guards, E2E stack, deploy, catalog import
├── tests/e2e/                   # Playwright
├── .github/workflows/           # CI/CD pipelines
├── capacitor.config.ts
├── docker-compose.yml
├── Dockerfile
├── pnpm-workspace.yaml
├── AGENTS.md                    # Operating contract for AI agents
└── README.md
```

### Persisted Model

The Drizzle schema in `apps/api/src/db/schema.ts` defines 29 tables and 20 enum types, grouped by area:

| Area | Tables |
|---|---|
| Tenancy and identity | `tenants`, `users`, `memberships`, `credentials`, `oauth_accounts`, `sessions` |
| Planning | `plan_drafts`, `plan_specs`, `workout_plans` |
| Tracking | `workout_sessions`, `session_exercises`, `set_records` |
| User context | `user_profiles`, `user_weight_entries`, `user_preferences`, `user_memory_vectors`, `vector_memory_settings` |
| Billing | `tenant_billing_states`, `tenant_billing_overrides`, `tenant_quota_counters`, `member_quota_allocations`, `member_quota_counters`, `billing_usage_ledger`, `billing_audit_events`, `stripe_processed_events` |
| Trainer and white label | `trainer_client_assignments`, `tenant_branding` |
| AI and observability | `ai_provider_config`, `observability_events` |

Two things deliberately live outside the database. The **exercise catalog** is a versioned package (`packages/exercise-catalog`) rather than a table, so the taxonomy and the body-zone load matrix are reviewed as code. And **declared limitations** are part of the `PlanSpec` payload stored in `plan_specs.spec_json`, not a separate entity — they describe a plan request, not a clinical record. **Coupons** are Stripe objects applied at checkout; the platform stores no coupon table of its own.

---

## e. Main Features

### Training Plan Definition

- Card mode: 7-step wizard (goal, days, duration, location, equipment, limitations, confirmation)
- Conversational mode: AI-guided chat with incremental data extraction, voice input and output supported
- Seamless switching between both modes without progress loss

### AI Personalization

- Plan generation based on goal, level, availability, and equipment
- Adaptation to injuries and physical limitations with intelligent exercise substitution
- Dynamic plan adjustment based on adherence, RPE, and actual progress
- Persistent memory: structured and vector-backed, visible and editable by the user

### AI Operation

- Provider selection for generation, transcription and synthesis without redeploying
- Prompts versioned in Langfuse and promoted by label; a fetch failure, a missing prompt, or a template that fails boundary validation falls back to the compiled-in template, so a Langfuse outage never breaks generation
- Every trace records which prompt source served the request
- Health-related text is redacted before it reaches any trace

### Workout Tracking

- Offline-first tracker with fast set logging (below / met / above)
- Body-zone feedback after injury-adapted exercises
- Post-session check-in with overall RPE and notes
- Recovery of abandoned sessions with an actionable conflict banner and read-only history

### Statistics and Progress

- Dashboard with adherence, weekly volume, streak, and personal records
- Per-exercise detail view with load progression
- Bodyweight-inclusive volume from the profile's body metrics
- Assistant memory panel with user management

### Plan Management

- Plan list on web and mobile
- Rename, edit, and bulk archive; plans are archived rather than deleted

### Account and Authentication

- Registration with email/password and Google OAuth
- Automatic account linking by email across providers
- Extensible architecture for additional social providers

### Subscription Model

- Free and Pro tiers with a 30-day Pro trial, no credit card required
- Coupon system for campaigns and referral programs
- Trainer tier with client management and branded plans
- B2B white label with per-gym branding

---

## f. Delivery Status

The project is built from versioned specs in `openspec/specs/`, following the SDD cycle defined in [`AGENTS.md`](./AGENTS.md). Every closed change is archived with its full audit trail in `openspec/changes/archive/`.

Mandatory principles throughout execution:

- The application **must install, start, and pass smoke checks from the very first slice**.
- **Clean Architecture** with inward-pointing dependencies and shared contracts.
- **Multi-tenant from the first commit.**
- **Security by design**: validation at boundaries, tenant isolation, and fail-secure by default.
- **Strict TDD**: RED → GREEN → Triangle for edge cases.
- UI work uses the local Open Design snapshot in `docs/open-design/kinora/` and the selected **Orbit** brand direction.
- Physical limitations generate **warnings and suggested substitutions**, never medical diagnosis or clinical blocking.

### v1 — MVP · delivered

| Spec | Scope | Archived |
|---|---|---|
| `01a-v1-monorepo-setup` | pnpm monorepo and bootable web + API baseline | 2026-06-20 |
| `01b-v1-clean-architecture-contracts` | Layers, shared contracts, dependency rules | 2026-06-20 |
| `01c-v1-multi-tenant-schema` | Tenant scope from the first migration | 2026-06-21 |
| `02-v1-infrastructure-ci-cd` | Docker, health checks, CI/CD, VPS deploy | 2026-06-21 |
| `03-v1-quality-tdd` | Test stack, coverage, RED-GREEN-Triangle flow | 2026-06-21 |
| `04-v1-ai-operation` | `AGENTS.md` and rules for AI collaboration | 2026-06-21 |
| `05b-v1-security-tenant-validation` | Tenant isolation, authorization, input validation | 2026-06-23 |
| `06-v1-mobile-foundation` | PWA, responsive baseline, native shell | 2026-06-24 |
| `05a-v1-auth-core` | Credentials, OAuth, account linking | 2026-06-26 |
| `06b-v1-orbit-ui-shell` | Orbit design system, landing, navigation | 2026-06-26 |
| `06c-v1-opendesign-component-foundation` | Shared icons and standard components | 2026-06-26 |
| `07-v1-plan-wizard` | Card-based create-plan flow producing `PlanSpec` | 2026-06-27 |
| `08-v1-ai-plan-generation` | AI plan generation with safe substitutions | 2026-07-06 |
| `09-ai-provider-admin` | Runtime provider and model selection | 2026-07-06 |
| `09a-v1-workout-tracking-core` | Live workout tracker | 2026-07-06 |
| `09b-plan-view` · `09c-plan-view-design` | Plan surfaces | 2026-07-06 |
| `85-route-layer-boundaries` | Route-layer boundaries | 2026-07-07 |
| `93-plan-navigation-and-start` | Plan navigation and session start | 2026-07-07 |
| `09b-v1-workout-offline-history` | Offline-first, sync, workout history | 2026-07-16 |
| `100-i18n-icu-adoption` | Shared ICU catalogs, web and mobile runtimes | 2026-07-16 |
| `09c-v1-progress-dashboard-stats` | Dashboard, statistics, exercise progress | 2026-07-20 |
| `09d-v1-offline-flush-hardening` | Offline flush hardening | 2026-07-21 |
| `09e-v1-e2e-resource-safety` | E2E resource safety | 2026-07-21 |
| `10-v1-sidebar-user-menu` | Sidebar user menu | 2026-07-21 |
| `10b-user-memory-vector` | Vector memory with embeddings | 2026-07-23 |
| `11a-billing-plans-tiers` | Free/Pro, 30-day trial, feature gating | 2026-07-23 |
| `10a-user-memory-structured` | Editable structured memory | 2026-07-25 |
| `11b-v1-billing-stripe-integration` | Stripe, webhooks, coupons | 2026-07-25 |

### v1.1 — Conversational interaction and adaptation · delivered

| Spec | Scope | Archived |
|---|---|---|
| `12-v1.1-interactive-text-chat` | Conversational create-plan flow | 2026-07-25 |
| `13-v1.1-interactive-voice-chat` | Voice assistant with STT and TTS | 2026-07-26 |
| `14a-v1.1-adaptation-adherence` | Adaptation based on actual adherence | 2026-07-26 |
| `14b-v1.1-adaptation-rpe-feedback` | Adaptation based on RPE and feedback | 2026-07-30 |

### v2 — Trainer tier · delivered

| Spec | Scope | Archived |
|---|---|---|
| `15a-v2-trainer-account-access` | Trainer account, permissions, client assignment | 2026-07-31 |
| `15b-v2-trainer-dashboard-branding` | Client dashboard, progress, branded plans | 2026-08-01 |

### v3 — B2B gyms · in progress

| Spec | Scope | Status |
|---|---|---|
| `16a-v3-gym-white-label` | White label: branding, domain, visual identity | Archived 2026-08-02 |
| `16d-admin-tier-provisioning` | Administrative tier provisioning | Archived 2026-08-02 |
| `16e-langfuse-prompt-management` | Remote prompt management and LLM observability | Archived 2026-08-07 |
| `16c-v3-b2b-seat-billing` | Per-seat billing | In progress |
| `16b-v3-gym-admin-multigym` | Gym administration, aggregate analytics, multi-location | Specified, not started |

### Product increments · delivered

| Spec | Scope | Archived |
|---|---|---|
| `17b-stale-session-recovery` | Abandoned-session recovery and read-only history | 2026-08-07 |
| `17c-profile-body-metrics` | Profile, body metrics, bodyweight-inclusive volume | 2026-08-08 |
| `17d-plan-management` | Plan list, archive, rename and edit | 2026-08-09 |

---

## g. Next steps

- Close `16c-v3-b2b-seat-billing` and start `16b-v3-gym-admin-multigym`.
- Wire a transactional email provider. Account and billing flows currently have no outbound email.
- Bring `.env.example` back in line with `docker-compose.yml`: the voice, Stripe, vector-memory and seat-billing variables are injected by Compose but not documented in the example file.
- Define a quality metric for generated plans, so provider and model changes can be compared on something other than latency and cost.
- Measure per-user LLM cost across providers, now that switching provider is an operational decision.
