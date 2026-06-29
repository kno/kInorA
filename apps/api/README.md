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

**Note on `OPENROUTER_MODEL`**: The OpenRouter adapter uses `.withStructuredOutput` with `method: "jsonSchema"`. The chosen model must support JSON-schema mode structured output. If unsure, prefer models from the OpenAI family (e.g. `openai/gpt-4o-mini`) or verify via the [OpenRouter model list](https://openrouter.ai/models).

**Privacy note**: `PlanSpec.limitations` (health context) is masked with `[REDACTED]` before the prompt reaches Langfuse. Raw limitation text never appears in traces.

### Optional / runtime tunables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP port to listen on |
| `HOST` | `0.0.0.0` | HTTP host to bind to |
| `NODE_ENV` | `development` | Runtime environment |

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
