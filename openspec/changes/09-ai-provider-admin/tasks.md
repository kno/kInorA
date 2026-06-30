# Tasks: 09-ai-provider-admin

## Review Workload Forecast
Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Medium (~400 lines estimated)

## Tasks

- [x] T1: Drizzle schema — add `isAdmin` to users table + `aiProviderConfig` table + generate migration
- [x] T2: `AiProviderConfigRepository` — `getActive()` + `upsert(provider, model)`
- [x] T3: `requireAdmin` preHandler in auth plugin
- [x] T4: Admin routes `GET /admin/ai-config` + `PUT /admin/ai-config`
- [x] T5: `DynamicPlanGenerator` — reads DB config per-request, delegates to correct adapter
- [x] T6: Provider adapters — openai, anthropic, google, opencode-go (openrouter already exists)
- [x] T7: Wire `DynamicPlanGenerator` into `buildApp` (replace direct `OpenRouterPlanGenerator`)
- [x] T8: Web page `/admin/ai-config` — server component + `AiConfigForm` client component
- [x] T9: Web route protection — non-admin redirect in server component
