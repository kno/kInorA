# Design: 09-ai-provider-admin

## DB

```sql
-- 1. is_admin on users (default false, retrocompatible)
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- 2. ai_provider_config singleton table
CREATE TABLE ai_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,  -- 'openrouter' | 'openai' | 'anthropic' | 'google' | 'opencode-go'
  model text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Drizzle schema + generated migration via `pnpm --filter api db:generate`.

## API Architecture

```
buildApp
  └── AiProviderConfigRepository  (reads DB: getActive, upsert)
       └── DynamicPlanGenerator   (PlanGenerator port implementation)
            └── per-request: configRepo.getActive() → build correct LangChain client
                ├── openrouter  → ChatOpenAI + baseURL openrouter
                ├── openai      → ChatOpenAI (no baseURL override)
                ├── anthropic   → ChatAnthropic
                ├── google      → ChatGoogleGenerativeAI
                └── opencode-go → ChatOpenAI + baseURL opencode-go
```

If DB returns no row → fallback to OPENROUTER_API_KEY (current behavior).

## requireAdmin preHandler

```ts
export function requireAdmin(db: Database) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authContext) return sendForbidden(reply);
    const user = await userRepo.findById(request.authContext.userId);
    if (!user?.isAdmin) return sendForbidden(reply, "not_admin");
  };
}
```

Reads `users.is_admin` — no role enum change needed.

## Admin Routes

```
GET  /admin/ai-config  → requireAuth + requireAdmin → AiProviderConfigRepository.getActive()
PUT  /admin/ai-config  → requireAuth + requireAdmin → validate body → upsert
```

Body schema (PUT):
```ts
{ provider: z.enum([...]), model: z.string().min(1) }
```

Response (GET/PUT):
```ts
{ provider: string, model: string, updatedAt: string } | null
```

## Web

```
apps/web/src/app/(app)/admin/ai-config/
  ├── page.tsx          (server component — checks admin, fetches config)
  └── AiConfigForm.tsx  (client component — select + input + submit)
```

Server component calls the API with the session token. If user is not admin
(API returns 403) → redirect('/').

Provider defaults map:
```ts
const MODEL_DEFAULTS = {
  openrouter: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  google: 'gemini-2.0-flash',
  'opencode-go': 'deepseek-v4-flash',
}
```

## LangChain adapters

- openrouter: existing `OpenRouterPlanGenerator` (refactored to accept config)
- openai: `ChatOpenAI` without baseURL, uses `OPENAI_API_KEY`
- anthropic: `ChatAnthropic` from `@langchain/anthropic`, uses `ANTHROPIC_API_KEY`
- google: `ChatGoogleGenerativeAI` from `@langchain/google-genai`, uses `GOOGLE_GENERATIVE_AI_API_KEY`
- opencode-go: `ChatOpenAI` with `baseURL: 'https://opencode.ai/zen/go/v1'`, uses `OPENCODE_GO_API_KEY`

New deps: `@langchain/anthropic`, `@langchain/google-genai` — both official LangChain packages.
