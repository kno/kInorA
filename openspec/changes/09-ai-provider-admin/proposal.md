# Proposal: 09-ai-provider-admin

## Problem
The AI provider/model is hardcoded via env vars. Changing provider requires SSH access
to the VPS and a container restart. There is no visibility into what is active nor
a way to change it without server access.

## Solution
Admin panel in the web app + API endpoint to read/write the active provider config in DB.
API keys stay in `.env` — only which provider and model is active is managed through the UI.

## Scope
1. DB: `is_admin` column on `users` + `ai_provider_config` table (singleton)
2. API: `GET /admin/ai-config` + `PUT /admin/ai-config` with `requireAdmin` guard
3. Generator: read config from DB on each generation (not just at startup)
4. Web: `/admin/ai-config` page, visible/accessible only to admins
5. Supported providers: openrouter, openai, anthropic, google, opencode-go

## Out of scope
- API key management from UI
- Multi-tenant admin
- Logs or metrics from the panel

## How to make a user admin
Direct SQL query on VPS — documented in PR body:
```sql
UPDATE users SET is_admin = true WHERE email = 'your@email.com';
```
