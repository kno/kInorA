# Documentation discrepancy report

> 🇪🇸 [Versión en español](./discrepancy-report_ES.md)

**Project:** kInorA
**Audit date:** August 10, 2026
**Audited reference:** `origin/main` (714 commits, latest `#446`)
**Documents reviewed:** `README.md`, `AGENTS.md`, `apps/api/README.md`, `docs/open-design-kinora.md`, `docs/billing/QA-CHECKLIST.md`, `docs/voice/stt-tts-abuse-meter-decision.md`
**Sources of truth used for comparison:** each workspace's `package.json`, `.env.example`, `docker-compose.yml`, `.github/workflows/ci-cd.yml`, `scripts/`, `capacitor.config.ts`, `.node-version`, and the `apps/`, `packages/` and `openspec/` trees

---

## Summary

**Twenty discrepancies** were found between the documentation and the code. Fourteen affect the root `README.md`, which is the project's entry document and the first thing any evaluator will read.

The number is not the relevant conclusion. The point is that **the README describes a system that is largely not the one that was built**: seven of the sixteen rows in its technology table name libraries or services that appear in no dependency anywhere in the repository, and the installation instructions contain two commands that fail when run.

At the other extreme, `apps/api/README.md` is an excellent, up-to-date document. It accurately documents OpenRouter, Langfuse, provider selection from the admin panel and health-data masking in traces. Everything missing upstairs is well written downstairs. The problem is one of propagation, not of knowledge.

| # | Severity | Location | Discrepancy |
|---|---|---|---|
| 1 | Critical | README §b | Claims Vercel AI SDK; the repository uses LangChain |
| 2 | Critical | README §b | Claims GPT-4o as the model; the model is resolved via OpenRouter and is configurable |
| 3 | Critical | README §b | Claims Whisper for STT; the repository uses Deepgram or Google, selectable |
| 4 | Critical | README §b | Claims OpenAI TTS; the repository uses Deepgram or Gemini, selectable |
| 5 | Critical | README §b | Claims Auth.js / NextAuth v5; no such dependency exists |
| 6 | Critical | README (all) | Langfuse is not mentioned even once |
| 7 | High | README §c | `cp apps/web/.env.example …` and `cp apps/api/.env.example …`: those files do not exist |
| 8 | High | README §c | `pnpm --filter api db:seed`: that script does not exist |
| 9 | High | README §c | Cites `AUTH_SECRET`, `RESEND_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: none of them exist |
| 10 | High | README §b | Claims Brevo for transactional email; there is no email provider at all |
| 11 | High | README §e / Roadmap | The roadmap presents v2 and v3 as future work; they are mostly closed |
| 12 | High | README §c | Requires pnpm ≥ 11; the repository pins pnpm 10.17.1 |
| 13 | Medium | README §b, §d | Presents mobile as a PWA in Capacitor; there is also a React Native + Expo app |
| 14 | Medium | README §d | The tree shows `packages/shared` and `mobile-shell/`; neither exists |
| 15 | Medium | README §d | Omits `packages/exercise-catalog` and `packages/i18n` |
| 16 | Medium | README §c | Requires PostgreSQL 18; Compose pins `pgvector/pgvector:pg17` |
| 17 | Medium | README §c | Describes deployment as `git pull` + `docker build` + `docker run`; the real pipeline publishes a multi-arch image to GHCR |
| 18 | Low | `.env.example` | Missing the voice, Stripe, vector-memory and seat-billing variables that Compose does inject |
| 19 | Low | `openspec/changes/` | `16d-admin-tier-provisioning` is both active and archived |
| 20 | Medium | README §d | The listed domain entities do not match the 28 tables in the schema |

---

## Findings in detail

### 1-4. The documented AI layer is not the one that was built

The README claims integration via the Vercel AI SDK, GPT-4o as the model, transcription with Whisper and synthesis with OpenAI TTS.

Not one of the four claims holds up. `apps/api/package.json` contains no Vercel AI SDK. It contains `@langchain/core`, `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai` and `langfuse-langchain`. Generation is resolved through OpenRouter with the model given in `OPENROUTER_MODEL`, whose example value is `openai/gpt-4o-mini` and not `gpt-4o`, and with the documented requirement that the chosen model support JSON-schema structured output.

On top of that, provider choice is a product feature: there is a panel at `/admin/ai-config` for switching between OpenAI, Anthropic, Google Generative AI and OpenCode-Go, with keys managed by the operator and never stored in the database or exposed in the UI. The README does not mention this capability.

For voice, `apps/api/src/ai/` contains `deepgram-speech-transcriber.ts`, `deepgram-speech-synthesizer.ts`, `google-speech-transcriber.ts`, `gemini-speech-synthesizer.ts` and a `voice-provider-factory.ts`. Compose injects `VOICE_STT_PROVIDER` and `VOICE_TTS_PROVIDER`. Whisper is nowhere to be found.

**Impact.** This is the costliest discrepancy in the report. The project has a swappable-provider architecture with ports, adapters, typed errors and retries on transient failures, and the entry document presents it as a single-provider integration. It hides the hardest technical work in the repository.

### 5. Auth.js is not in the project

The README credits authentication to Auth.js (NextAuth v5). There is no trace of `next-auth` or `@auth/*` in any dependency, neither in the frontend nor in the API.

What does exist is a bespoke implementation in `apps/api/src/auth/`: password policy and hashing in `service.ts`, a Google OIDC client via `openid-client`, sessions on `@fastify/cookie`, account linking in `social-wiring.ts` and tenant selection in `tenant-selection.ts`.

**Impact.** Beyond being inaccurate, it sells the work short: implementing your own authentication with automatic account linking and multi-tenant isolation is substantially more work than configuring a library, and as documented it reads as the latter.

### 6. Langfuse does not appear in the README

Zero occurrences. It is the piece that turns the system into operated AI: remote versioned prompts under the `production` label, boundary template validation with drift detection reported as an observability event, fallback to the compiled template when Langfuse does not respond, every trace tagged with `promptSource`, and `PlanSpec.limitations` masked with `[REDACTED]` so that health text never reaches the trace.

All of this is correctly documented in `apps/api/README.md` and has not made its way up to the root document.

### 7-9. The installation instructions cannot be followed

Step 3 says to copy `apps/web/.env.example` and `apps/api/.env.example`. Neither file exists: the example configuration lives in a single `.env.example` at the root. Both commands fail.

Step 5 offers `pnpm --filter api db:seed` as an optional catalogue seed. `apps/api/package.json` defines no `db:seed`, and the concept itself is wrong: **the exercise catalogue is not seeded into the database**. It ships as a versioned package in `packages/exercise-catalog`, with self-hosted thumbnails in `apps/web/public/exercises/`. The root script `pnpm import:exercise-catalog` is a maintenance tool that rebuilds that package and replicates the assets from the version-pinned upstream dataset, and it never touches the database.

The list of variables to configure cites `AUTH_SECRET`, `RESEND_API_KEY`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. None of the four is read in the code, appears in `.env.example` or is injected by Compose.

**Impact.** An evaluator trying to stand the project up by following the README gets stuck at step three.

### 10. There is no email provider

The README claims Brevo for transactional email, while the variable list asks for a Resend key — two different services for the same job. Searching the whole repository for `brevo`, `resend`, `nodemailer` and `sendgrid` returns no integration at all: the only hits are UI literals about email fields.

The feature is not built. It should come out of the technology table and, if it is still on the plan, show up under next steps.

### 11. The roadmap is out of date

The README presents four milestones with v2 and v3 as future work. The SDD archive says otherwise: `15a` and `15b` (Trainer tier) have been closed since July 31 and August 1, and `16a` (white-label), `16d` (tier provisioning) and `16e` (Langfuse) since early August.

The entire 17x series is also missing, and it is already-delivered product: `17b` abandoned-session recovery, `17c` profile with body metrics and `17d` plan management. Also missing is the archived cross-cutting work that does not fit the version numbering: i18n adoption with ICU, hardening of the offline flush, resource security in E2E, route-layer limits and the user menu.

**Impact.** The document understates the project's actual scope. It is the only error in this report that directly damages how the work is assessed.

### 12. Contradictory pnpm version

The prerequisites ask for pnpm ≥ 11. The root `package.json` pins `"packageManager": "pnpm@10.17.1"` and `.env.example` documents that the VPS has pnpm 10.17.1. Following the README installs a higher version than the one Corepack pins.

The Node requirement is correct: `.node-version` says 24.17.0 and `engines` requires `>=24.17.0`.

### 13-15. The project structure does not match

The README's tree shows `packages/shared/` as the only shared package and a `mobile-shell/` directory for Capacitor. There are actually four packages — `contracts`, `domain`, `exercise-catalog` and `i18n` — and no `mobile-shell/`: the Capacitor configuration is in `capacitor.config.ts` at the root, pointing at `apps/web/.next`, with the native project in `android/`.

More importantly, the tree omits `apps/mobile`, which is not a wrapper around the web app but a **React Native 0.79 application on Expo 53**, with its own navigation, secure storage, connectivity detection, audio and its own internationalisation runtime. The README describes the mobile strategy as "a PWA embedded in a native shell via Capacitor", and that covers only one of the two existing paths.

### 16. PostgreSQL version

The prerequisites ask for PostgreSQL 18. Compose pins `pgvector/pgvector:pg17`, and the README itself gets it right four paragraphs further down when explaining the vector-memory migration. Fixing the prerequisite is enough to stop the document contradicting itself.

### 17. The documented deployment is not the real one

The README describes deployment as three commands on the VPS: `git pull`, `docker build`, `docker run`.

The real `ci-cd.yml` pipeline has six phases: CI with type checking, tests and guards; billing integration against a real Postgres; a build-and-boot test of the Docker image; a matrix multi-arch image build; multi-arch manifest merge; and deployment to the VPS. Deployment runs over SSH with the configuration passed as a base64 payload to avoid command-line injection, with host fingerprint pinning instead of trust-on-first-use, and with explicit precedence of pipeline-managed variables over the operator's persistent `.env` — precisely so that a stale value cannot make a green deployment run an old image.

**Impact.** Here the documentation is not merely inaccurate: it describes a considerably poorer process than the one implemented. The pipeline is dissertation material on its own.

### 18. `.env.example` lags behind Compose

`docker-compose.yml` interpolates forty-one variables. `.env.example` documents twenty-one. Missing are the voice ones (`DEEPGRAM_API_KEY`, `DEEPGRAM_STT_MODEL`, `DEEPGRAM_STT_LANGUAGE`, `DEEPGRAM_TTS_MODEL`, `VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER`), the Stripe ones (eight, including the trainer-seat ones), the six vector-memory ones, `SEAT_BILLING_ENABLED` and `LANGFUSE_PROMPT_CACHE_TTL_MS`.

`apps/api/README.md` itself warns that forgetting to forward a variable in Compose's `environment:` block silently leaves the container on the default value, and cites a real instance of that class of failure with Stripe. The inverse risk — a variable in Compose but undocumented — is the one present now.

### 20. The listed domain entities do not match the model

The "Main Domain Entities" section lists `AuthIdentity`, `Organization`, `Limitation`, `Exercise`, `UserMemory`, `Coupon` and `Subscription`. None of them exists under that name in the schema.

The real schema defines twenty-eight tables. Identity is spread across `users`, `credentials`, `memberships` and `sessions`; the tenant scope is `tenants`; memory is `user_memory_vectors` plus `vector_memory_settings`, `user_preferences` and `user_profiles`; and billing is eight tables, none of them for coupons.

And there are two design decisions the list hides that deserve telling: the exercise catalogue **is not a table**, it is a versioned package, so the pattern taxonomy and the per-body-region load matrix are reviewed as code; and declared limitations **are not an entity**, they live inside `plan_specs.spec_json` because they describe a plan request and not a clinical history. Both are defensible decisions and neither was documented.

### 19. Duplicated change folder

`openspec/changes/16d-admin-tier-provisioning` is still active while `openspec/changes/archive/2026-08-02-16d-admin-tier-provisioning` already exists. It is an archiving leftover. `16c-v3-b2b-seat-billing` is legitimately active.

---

## Corrections applied on this branch

`README.md` rewritten in English with the real technology table, the real directory structure, prerequisites and commands verified one by one, deployment described according to the pipeline, and delivery status updated against the SDD archive.

`README.es.md` created as the Spanish equivalent, cross-linked from the English document.

No code or configuration file has been modified. Findings 18 and 19 are documented here but **not fixed**, since they are changes to configuration and to the `openspec/` tree that go beyond the scope of a documentation task and deserve a review of their own.
