# kInorA

Personalized training powered by **A**rtificial **I**ntelligence.

kInorA generates and adapts training plans tailored to each user — goals, level, available equipment, and physical limitations — through two interaction modes: a visual card wizard and a conversational voice assistant. The system learns from the user's actual progress session by session and adjusts the plan continuously.

---

## a. Overview

kInorA is a platform composed of a **web** (public landing + private area) and a **mobile app**, with an AI engine at the product's core. Its distinguishing features:

- **Plan definition in two modes**: cards (fast, visual) or conversational with voice (natural, nuanced). Both modes feed the same data structure, so the user can switch between them without losing progress.
- **Physical limitation adaptation**: the user declares injuries, chronic conditions, or mobility limitations, and the AI filters, substitutes, or adjusts exercises accordingly — always as a suggestion, never as a medical diagnosis.
- **Available equipment adaptation**: the plan respects what the user has access to (full gym, limited home equipment, or nothing). If an exercise turns out to be unfeasible after plan generation, it is automatically replaced with an equivalent.
- **Persistent user memory**: the AI remembers preferences, equipment, context, and behavior patterns between sessions, enriching every future interaction. The user can view, edit, and delete this memory.
- **Offline-first workout tracking**: set logging with a three-state flow (below / met / above) optimized for gym use, with automatic sync when connectivity is restored.
- **Freemium model with trial**: functional free tier, 30-day Pro trial with no credit card required, and a coupon system for campaigns and referrals.

---

## b. Tech Stack

| Layer                       | Technology                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Frontend (web)              | Next.js + TypeScript                                                                           |
| Backend (API)               | Fastify + Node.js                                                                              |
| Database                    | PostgreSQL                                                                                     |
| ORM                         | Drizzle                                                                                        |
| Authentication              | Auth.js (NextAuth v5) — email/password + Google OAuth, with automatic account linking by email |
| LLM Integration             | Vercel AI SDK (provider-agnostic)                                                              |
| LLM Model                   | OpenAI GPT-4o                                                                                  |
| Speech-to-Text (STT)        | OpenAI Whisper                                                                                 |
| Text-to-Speech (TTS)        | OpenAI TTS                                                                                     |
| Payments & Subscriptions    | Stripe                                                                                         |
| Transactional Email         | Brevo                                                                                          |
| Asset Storage               | VPS                                                                                            |
| Mobile App                  | PWA embedded in native shell via Capacitor                                                     |
| Repository                  | Monorepo — pnpm workspaces                                                                     |
| Infrastructure              | VPS + Docker                                                                                   |
| CI/CD                       | GitHub Actions                                                                                 |

---

## c. Installation and Execution

### Prerequisites

- Node.js ≥ 24
- pnpm ≥ 11
- Docker and Docker Compose
- PostgreSQL 18 (or use the included container)
- OpenAI or OpenRouter account with API key
- Stripe account (test mode for development)
- Google OAuth credentials

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/<org>/kinora.git
   cd kinora
   ```

2. Install monorepo dependencies:

   ```bash
   pnpm install
   ```

3. Copy the example environment variable file into each app and fill in the values:

   ```bash
   cp apps/web/.env.example apps/web/.env
   cp apps/api/.env.example apps/api/.env
   ```

   Key variables to configure: `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

4. Start the local database:

   ```bash
   docker compose up -d postgres
   ```

5. Run migrations:

   ```bash
   pnpm --filter api db:migrate
   ```

   _(optional)_ Seed the exercise catalog with initial data:

   ```bash
   pnpm --filter api db:seed
   ```

### Development Execution

Start web and API in parallel:

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

### Production Build

```bash
pnpm build
```

### Deployment

Deployment is automatic via GitHub Actions on push to `main`. The pipeline runs on the VPS:

```bash
git pull origin main
docker build -t kinora .
docker run -d --env-file .env -p 80:3000 kinora
```

The `.env` file for production lives exclusively on the VPS and is never uploaded to the repository. Pipeline credentials (SSH, etc.) are managed as GitHub Actions Secrets.

---

## d. Project Structure

```
kinora/
├── apps/
│   ├── web/                    # Next.js — landing, private area, dashboard
│   │   ├── app/                # Next.js App Router
│   │   ├── components/         # React components
│   │   └── .env.example
│   │
│   └── api/                    # Fastify — business logic and endpoints
│       ├── src/
│       │   ├── routes/         # REST endpoints
│       │   ├── modules/        # Domain: plans, exercises, limitations, memory, tracking, billing
│       │   ├── db/             # Drizzle schema and migrations
│       │   └── ai/             # Vercel AI SDK integrations (LLM, STT, TTS)
│       └── .env.example
│
├── packages/
│   └── shared/                 # Shared TypeScript types and Zod schemas between web and api
│
├── mobile-shell/                # Capacitor configuration — wraps the PWA in a native shell
│
├── .github/
│   └── workflows/              # CI/CD pipelines
│
├── docker-compose.yml           # Local environment (Postgres, etc.)
├── Dockerfile
├── pnpm-workspace.yaml
└── README.md
```

### Main Domain Entities

- `User` / `AuthIdentity` — users and their linked authentication methods
- `Organization` — prepared for multi-tenant (Trainer tier and B2B in future versions)
- `Limitation` — declared injuries and physical limitations
- `Exercise` — exercise catalog with pattern taxonomy and body-zone load matrix
- `PlanSpec` — plan specification, populated from card or conversational mode
- `WorkoutSession` / `SessionExercise` / `SetRecord` — workout tracking hierarchy
- `UserMemory` — persistent user context memory for AI personalization
- `Coupon` / `Subscription` — payment plan management, trials, and promotions

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
- Persistent memory: the AI remembers preferences, equipment, and context between sessions, visible and editable by the user

### Workout Tracking

- Offline-first tracker with fast set logging (below / met / above)
- Body-zone feedback after injury-adapted exercises
- Post-session check-in with overall RPE and notes

### Statistics and Progress

- Dashboard with adherence, weekly volume, streak, and personal records
- Per-exercise detail view with load progression
- Assistant memory panel with user management

### Account and Authentication

- Registration with email/password and Google OAuth
- Automatic account linking by email across providers
- Extensible architecture for additional social providers

### Subscription Model

- Free and Pro tiers
- 30-day Pro trial with no credit card required
- Coupon system for campaigns and referral programs
- Architecture prepared (not active in v1) for Trainer tier and B2B gyms

---

## Roadmap

- **v1** — MVP: card mode, AI plan generation, tracker, Free/Pro tiers
- **v1.1** — Conversational mode with voice, dynamic plan adaptation
- **v2** — Trainer tier: client management, branded plans
- **v3** — B2B Gyms: white label, multi-tenant integration

---

## Execution Plan by Spec

The project will be built from scratch following versioned specs in `openspec/specs/`. The order is deliberate: executable foundations first, then security and product, and only then advanced capabilities. Each spec must produce a small, bootable, and verifiable slice.

Mandatory principles throughout execution:

- The application **must install, start, and pass smoke checks from the very first slice**.
- **Clean Architecture** with inward-pointing dependencies and shared contracts.
- **Multi-tenant from the first commit**, even though Trainer/B2B arrive in later versions.
- **Security by design**: validation at boundaries, tenant isolation, and fail-secure by default.
- **Strict TDD**: RED → GREEN → Triangle for edge cases.
- Mobile support from v1: **PWA/mobile-first + Capacitor preparation**.
- Physical limitations generate **warnings and suggested substitutions**, never medical diagnosis or clinical blocking.

### v1 — Launchable MVP

| Order | Spec | Goal |
|------:|------|------|
| 01a | `01a-v1-monorepo-setup` | Create the pnpm monorepo and a bootable baseline with web + API. |
| 01b | `01b-v1-clean-architecture-contracts` | Define layers, shared contracts, and dependency rules. |
| 01c | `01c-v1-multi-tenant-schema` | Establish tenant scope from the first model/migration. |
| 02 | `02-v1-infrastructure-ci-cd` | Docker, local environment, health checks, CI/CD, and VPS deploy. |
| 03 | `03-v1-quality-tdd` | Test stack, coverage, and RED-GREEN-Triangle flow. |
| 04 | `04-v1-ai-operation` | `AGENTS.md`, project skills, and rules for optimal AI collaboration. |
| 05a | `05a-v1-auth-core` | Auth.js, email/password, OAuth, and account linking. |
| 05b | `05b-v1-security-tenant-validation` | Tenant isolation, authorization, and input validation. |
| 06 | `06-v1-mobile-foundation` | PWA, responsive baseline, and Capacitor shell. |
| 07 | `07-v1-plan-wizard` | Visual card wizard that produces `PlanSpec`. |
| 08 | `08-v1-ai-plan-generation` | AI plan generation with safe substitutions. |
| 09a | `09a-v1-workout-tracking-core` | Online session, set, RPE, and notes logging. |
| 09b | `09b-v1-workout-offline-history` | Offline-first, sync, and workout history. |
| 10a | `10a-v1-user-memory-structured` | Editable structured memory: profile, preferences, and training data. |
| 10b | `10b-v1-user-memory-vector` | Conversational memory with embeddings/vector store. |
| 11a | `11a-v1-billing-plans-tiers` | Free/Pro, 30-day trial, and feature gating. |
| 11b | `11b-v1-billing-stripe-integration` | Stripe in test mode, webhooks, and coupons. |

### v1.1 — Conversational Interaction and Adaptation

| Order | Spec | Goal |
|------:|------|------|
| 12 | `12-v1.1-interactive-text-chat` | Text chat that extracts and confirms `PlanSpec`. |
| 13 | `13-v1.1-interactive-voice-chat` | Voice with Whisper STT and OpenAI TTS. |
| 14a | `14a-v1.1-adaptation-adherence` | Adaptation based on actual user adherence. |
| 14b | `14b-v1.1-adaptation-rpe-feedback` | Adaptation based on RPE, feedback, and perceived intensity. |

### v2 — Trainer Tier

| Order | Spec | Goal |
|------:|------|------|
| 15a | `15a-v2-trainer-account-access` | Trainer account, permissions, and client assignment. |
| 15b | `15b-v2-trainer-dashboard-branding` | Client dashboard, progress, and branded plans. |

### v3 — B2B Gyms

| Order | Spec | Goal |
|------:|------|------|
| 16a | `16a-v3-gym-white-label` | White label: branding, domain/subdomain, and visual identity. |
| 16b | `16b-v3-gym-admin-multigym` | Gym administration, aggregate analytics, and multi-location. |
