# Tasks: 09-ai-provider-admin

## Review Workload Forecast
Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Medium (~400 lines estimated)

## Tasks

- [ ] T1: Drizzle schema — add `isAdmin` to users table + `aiProviderConfig` table + generate migration
- [ ] T2: `AiProviderConfigRepository` — `getActive()` + `upsert(provider, model)`
- [ ] T3: `requireAdmin` preHandler in auth plugin
- [ ] T4: Admin routes `GET /admin/ai-config` + `PUT /admin/ai-config`
- [ ] T5: `DynamicPlanGenerator` — reads DB config per-request, delegates to correct adapter
- [ ] T6: Provider adapters — openai, anthropic, google, opencode-go (openrouter already exists)
- [ ] T7: Wire `DynamicPlanGenerator` into `buildApp` (replace direct `OpenRouterPlanGenerator`)
- [ ] T8: Web page `/admin/ai-config` — server component + `AiConfigForm` client component
- [ ] T9: Web route protection — non-admin redirect in server component
