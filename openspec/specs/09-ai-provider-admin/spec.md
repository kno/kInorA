# Spec: 09-ai-provider-admin

## Scenarios

SC-01: GET /admin/ai-config — unauthenticated → 401
SC-02: GET /admin/ai-config — authenticated, not admin → 403
SC-03: GET /admin/ai-config — admin user → 200 { provider, model, updatedAt }
SC-04: PUT /admin/ai-config — unknown provider → 422
SC-05: PUT /admin/ai-config — valid payload → 200, config updated in DB
SC-06: PUT /admin/ai-config — not admin → 403
SC-07: Generation with provider openai → uses OPENAI_API_KEY + OpenAI baseURL
SC-08: Generation with provider anthropic → uses ANTHROPIC_API_KEY
SC-09: Generation with provider google → uses GOOGLE_GENERATIVE_AI_API_KEY
SC-10: Generation with provider opencode-go → uses OPENCODE_GO_API_KEY + OpenCode baseURL
SC-11: Generation with provider openrouter → existing behavior (no change)
SC-12: No DB config → fallback to current env vars (retrocompatibility)
SC-13: Web panel — non-admin user → redirect to /
SC-14: Web panel — admin user → shows current config, allows changing provider/model
SC-15: Web panel — submit → calls PUT, shows confirmation

## Invariants
- API keys are NEVER read from DB or shown in the panel
- Config change takes effect on the NEXT generation (not mid-request hot-swap)
- Single active record in ai_provider_config at all times (upsert, not append)
