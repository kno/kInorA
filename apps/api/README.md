# kInorA API

Fastify-based REST API for the kInorA fitness planning application.

## Environment Variables

All variables are read at runtime. Unit tests do not require any of the optional vars — they use `MockPlanGenerator` and mocked infrastructure.

### Required (all environments)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgres://user:pass@host:5432/db`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `WEB_PUBLIC_ORIGIN` | Public origin of the web app (e.g. `https://kinora.example.com`) — used to derive the OAuth redirect URI |

### AI plan generation (08-v1-ai-plan-generation) — required in production

These variables are required for the OpenRouter LLM adapter and Langfuse observability. They are **not** needed for unit tests (the test suite uses `MockPlanGenerator`).

**How to configure**: set them in a `.env` file — locally in the project root (for dev), or in `$DEPLOY_DIR/.env` on the VPS (for production). They are **not** GitHub secrets and are not injected by the CI/CD workflow.

> **Production**: create a persistent `.env` in the VPS deploy directory with these vars. It is not managed by CI and survives across deploys.

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes (prod) | OpenRouter API key. Obtain at https://openrouter.ai/keys. |
| `OPENROUTER_MODEL` | Yes (prod) | OpenRouter model identifier in `provider/model` namespace. **Must** be a model that supports JSON-schema structured output (e.g. `openai/gpt-4o-mini`). Models that only support function-calling will fail at generation time. |
| `LANGFUSE_PUBLIC_KEY` | Yes (prod) | Langfuse project public key for LLM call tracing. |
| `LANGFUSE_SECRET_KEY` | Yes (prod) | Langfuse project secret key. |
| `LANGFUSE_HOST` | Yes (prod) | Langfuse host URL (e.g. `https://cloud.langfuse.com` for Langfuse Cloud, or your self-hosted instance). |
| `LANGFUSE_BASEURL` | No | SDK-conventional alias for the Langfuse host, for local dev. Precedence: `LANGFUSE_BASEURL ?? LANGFUSE_HOST` — when both are set, `LANGFUSE_BASEURL` wins. Production sets only `LANGFUSE_HOST`; that value is passed explicitly as `baseUrl`, never relying on the SDK's implicit environment pickup. |
| `LANGFUSE_PROMPT_CACHE_TTL_MS` | No | In-process cache TTL (milliseconds) for the remote prompt provider. Default `60000` (60s) when unset, unparseable, or non-positive — never throws at startup. **Must be forwarded in `docker-compose.yml`'s api `environment:` block** (compose only injects vars listed there; a missing forward silently keeps the container on the built-in default, the same class of bug PR #254 shipped for Stripe). |

**Note on `OPENROUTER_MODEL`**: The OpenRouter adapter uses `.withStructuredOutput` with `method: "jsonSchema"`. The chosen model must support JSON-schema mode structured output. If unsure, prefer models from the OpenAI family (e.g. `openai/gpt-4o-mini`) or verify via the [OpenRouter model list](https://openrouter.ai/models).

**Privacy note**: `PlanSpec.limitations` (health context) is masked with `[REDACTED]` before the prompt reaches Langfuse. Raw limitation text never appears in traces.

**Tracing (langfuse-prompt-management)**: a Langfuse `CallbackHandler` is constructed once per app instance, only when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are present. Absent or invalid credentials never fail a request — plan generation and chat succeed with the same prompt output either way, and a construction/emission/flush failure is reported as exactly one secret-free warn line (reason code + error name only, never a credential or prompt body).

**Remote prompt source (langfuse-prompt-management, slice B2)**: the three prompts — `kinora-plan-generation`, `kinora-chat-reply`, `kinora-chat-extraction` — are resolved at runtime from Langfuse under the fixed `production` label (see `LANGFUSE_PROMPT_CACHE_TTL_MS` above for the cache window). Promoting a new version to `production` in the Langfuse UI is the only gate; no env var, deploy, or code change is needed. A fetch failure, missing prompt, or a template that fails boundary validation (unknown variable, missing/relocated required marker, or an unresolved `{{` after rendering) always falls back to the compiled-in local template — plan generation and chat never fail because Langfuse was unreachable. Every trace carries `promptSource: "langfuse" | "fallback"`. Until the three prompts exist in the Langfuse project under `production`, the served behaviour is the local template with reason `prompt_not_found` — a valid, tested steady state, not a bug.

### AI provider admin (09-ai-provider-admin) — operator-managed, optional

The active AI provider and model can be changed via the admin panel at `/admin/ai-config`. Only the key for the **currently selected provider** needs to be set. Keys are never stored in the database or shown in the UI.

| Variable | When needed | Description |
|---|---|---|
| `OPENAI_API_KEY` | Only when provider `openai` is selected | OpenAI API key. Obtain at https://platform.openai.com/api-keys |
| `ANTHROPIC_API_KEY` | Only when provider `anthropic` is selected | Anthropic API key. Obtain at https://console.anthropic.com/settings/keys |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Only when provider `google` is selected | Google Generative AI key. Obtain at https://ai.google.dev/gemini-api/docs/api-key |
| `OPENCODE_GO_API_KEY` | Only when provider `opencode-go` is selected | OpenCode-Go API key. Obtain at https://opencode.ai |

**To make a user admin** (direct SQL — no admin UI for this):
```sql
UPDATE users SET is_admin = true WHERE email = 'your@email.com';
```

**Configure**: set keys in the operator `.env` on the VPS. They are **not** GitHub secrets and not injected by CI/CD (same pattern as `OPENROUTER_API_KEY`).

### Voice — STT and TTS (13-v1.1-interactive-voice-chat)

Transcription and synthesis providers are selected **independently** at deploy time, so a deployment can use Deepgram for transcription while keeping OpenAI for synthesis. This is an env decision, not a per-tenant runtime config, and it is not stored in the database.

Fail-safe: an unknown or unset provider value falls back to `openai`, so a misconfigured environment can never leave voice with no adapter.

| Variable | Default | Description |
|---|---|---|
| `VOICE_STT_PROVIDER` | `openai` | `openai` \| `google` (Gemini STT) \| `deepgram` (Listen). Unknown → `openai`. |
| `VOICE_TTS_PROVIDER` | `openai` | `openai` \| `google` (Gemini TTS, `audio/wav`) \| `deepgram` (Aura-2, container-wrapped `audio/wav`). Unknown → `openai`. |
| `DEEPGRAM_API_KEY` | — | Required when either provider is `deepgram`. Without it the adapters fall back to a placeholder key and every live call fails. |
| `DEEPGRAM_STT_MODEL` | `nova-2` | Deepgram Listen model. |
| `DEEPGRAM_STT_LANGUAGE` | `es` | Deepgram Listen language. |
| `DEEPGRAM_TTS_MODEL` | `aura-2-carina-es` | Deepgram Aura-2 voice. |
| `GOOGLE_STT_MODEL` | `gemini-2.5-flash` | Gemini STT model. |
| `GOOGLE_TTS_MODEL` | `gemini-2.5-flash-preview-tts` | Gemini TTS model. |
| `GOOGLE_TTS_VOICE` | `Kore` | Gemini TTS voice. |
| `GOOGLE_TTS_STYLE_DIRECTIVE` | built-in | Style directive prepended to the Gemini TTS prompt. Not overridable in containers — see below. |

The Google/Gemini adapters authenticate with `GOOGLE_GENERATIVE_AI_API_KEY`. Setting both `VOICE_*` variables to `google` or `deepgram` gives a fully OpenAI-free voice stack.

> **`GOOGLE_TTS_STYLE_DIRECTIVE` is deliberately not forwarded in Compose.** The synthesizer resolves it with `?? DEFAULT_TTS_STYLE_DIRECTIVE`, and Compose interpolates an unset variable to the empty string, which is not nullish. Forwarding it bare would replace the Castilian-accent directive with `""` on every deploy that does not set it — worse than not being able to override it. The same applies to an empty assignment in `.env`. Making it overridable requires the adapter to treat an empty value as unset first.

### Vector memory (10b-user-memory-vector)

These values define the embedding cohort persisted in pgvector. Keep them stable per environment: changing the model, version or dimension without a coordinated re-embed creates an incompatible cohort that retrieval intentionally skips. The data is not lost, it simply stops being returned.

| Variable | Default | Description |
|---|---|---|
| `VECTOR_MEMORY_EMBEDDING_PROVIDER` | `openai` | Embedding provider. |
| `VECTOR_MEMORY_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model. Must match the persisted rows. |
| `VECTOR_MEMORY_EMBEDDING_VERSION` | `text-embedding-3-small` | Cohort version tag stored alongside each vector. |
| `VECTOR_MEMORY_EMBEDDING_DIMENSION` | `1536` | Vector dimension. Must match the persisted rows. |
| `VECTOR_MEMORY_EMBEDDING_TIMEOUT_MS` | `3000` | Per-call embedding timeout. |
| `VECTOR_MEMORY_EMBEDDING_MAX_ATTEMPTS` | `2` | Retry attempts for a transient embedding failure. |

### Billing — Stripe (11b-v1-billing-stripe-integration)

Without these the Stripe gateway is unconfigured and the whole billing flow — checkout, portal and webhook — fails closed.

| Variable | Default | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | — | Stripe secret key. Use a test-mode key in development. |
| `STRIPE_WEBHOOK_SECRET` | — | Signing secret for the webhook endpoint. |
| `STRIPE_PRICE_MONTHLY` | — | Stripe Price id for the monthly Pro plan. |
| `STRIPE_PRICE_ANNUAL` | — | Stripe Price id for the annual Pro plan. |
| `STRIPE_PRICE_MONTHLY_AMOUNT` | — | Display amount in minor units. Drives pricing copy only. |
| `STRIPE_PRICE_ANNUAL_AMOUNT` | — | Display amount in minor units. Drives pricing copy and the annual save badge. |
| `STRIPE_PRICE_CURRENCY` | `eur` | ISO-4217 code, lowercased at read time. |

The `*_AMOUNT` variables never charge anything by themselves; the Price id is what Stripe bills. They exist so the pricing page and the save badge can render without a Stripe round trip.

### Seat billing — Trainer tier (16c-v3-b2b-seat-billing)

| Variable | Default | Description |
|---|---|---|
| `STRIPE_PRICE_TRAINER_SEAT_MONTHLY` | — | Per-seat Stripe Price id, monthly. |
| `STRIPE_PRICE_TRAINER_SEAT_ANNUAL` | — | Per-seat Stripe Price id, annual. |
| `SEAT_BILLING_ENABLED` | `0` | Set to `1` to activate the outbound Stripe seat-quantity sync. |

### Optional / runtime tunables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP port to listen on |
| `HOST` | `0.0.0.0` | HTTP host to bind to |
| `NODE_ENV` | `development` | Runtime environment |

### The Compose forwarding rule

Compose only injects variables listed under a service's `environment:` block. A variable that exists in the root `.env.example` and in the VPS `.env` but is missing from that block is silently ignored inside the container, which keeps its built-in default instead.

This has shipped as a real bug more than once — `STRIPE_*` in PR #254, and later `VOICE_*` and `DEEPGRAM_*`. When adding a variable, add the matching forward in `docker-compose.yml` in the same change, and document it in `.env.example` and here.

## Development

```sh
# Install dependencies from repo root
pnpm install

# Run in dev mode (tsx watch)
pnpm --filter api dev

# Run unit tests
pnpm --filter api test

# Type-check
pnpm --filter api type-check

# Build (tsc)
pnpm --filter api build
```

## Database

```sh
# Generate a new migration after schema changes
pnpm --filter api db:generate

# Apply migrations
pnpm --filter api db:migrate
```

The local/CI runtime must provide `pgvector/pgvector:pg17` (or another
Postgres 17 image with pgvector installed) before running
`pnpm --filter api db:migrate`, because the 10b Slice 1 migration executes
`CREATE EXTENSION vector;`.

For 10b vector memory rollout, keep `VECTOR_MEMORY_EMBEDDING_MODEL` and
`VECTOR_MEMORY_EMBEDDING_DIMENSION` aligned with the persisted embedding cohort
(`text-embedding-3-small` / `1536` by default). If those values change without a
coordinated re-embed, retrieval will intentionally exclude incompatible rows.

Current rollback boundary: unset `OPENAI_API_KEY` (or otherwise leave the vector
embedding runtime misconfigured) to make confirmed-memory writes/retrieval fail
open while preserving the rest of the API. Do not remove `CREATE EXTENSION vector`
from the migration or downgrade the checked-in runtime to a plain `postgres:*`
image.
