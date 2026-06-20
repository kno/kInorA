# Tasks: 01a V1 Monorepo Setup

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 400–500 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation + Contracts) → PR 2 (Web i18n) → PR 3 (API + Integration) |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Workspace scaffold, configs, shared contracts | PR 1 | Base: `01a-v1-monorepo-setup` branch; standalone installable |
| 2 | i18n resolution, localised page, mobile-safe layout | PR 2 | Base: PR 1 branch; depends on PR 1 tsconfig + workspace |
| 3 | API health endpoint, root scripts, dependency guard | PR 3 | Base: PR 2 branch; depends on PR 1 contracts + workspace |

## Phase 1: Foundation

- [x] 1.1 Create `pnpm-workspace.yaml` declaring `apps/*` and `packages/*`
- [x] 1.2 Create root `package.json` — `dev`, `build`, `type-check`, `test` scripts; `engines.node` ≥24.17.0; exact versions
- [x] 1.3 Create `.node-version` pinning Node.js 24.17.0
- [x] 1.4 Create `tsconfig.base.json` — `strict: true`, ESNext module, path aliases
- [x] 1.5 Create `.npmrc` — `shamefully-hoist=false`, `strict-peer-dependencies=true`
- [x] 1.6 Create `packages/contracts/src/index.ts` exporting `HealthResponse` type + `package.json` (`@kinora/contracts`) + `tsconfig.json`
- [x] 1.7 Create `apps/web/package.json` (Next.js 16.2.9, React 19.2.7, exact) + `tsconfig.json` + `next.config.ts` + `public/`
- [x] 1.8 Create `apps/api/package.json` (Fastify 5.8.5, tsx, exact) + `tsconfig.json`
- [x] 1.9 Update `.gitignore` — add `node_modules/`, `.next/`, `dist/`, `.env*`

## Phase 2: i18n & Web Page (TDD)

- [x] 2.1 RED: Write failing test for `resolveLocale` — Accept-Language parsing, `?lang` override, unsupported fallback to `en`
- [x] 2.2 GREEN: Implement `apps/web/src/i18n/locale.ts` — `resolveLocale(acceptLanguage, langParam)` and `loadMessages(locale)`
- [x] 2.3 Create `apps/web/src/i18n/messages/en.json` and `es.json` with title, subtitle, cta
- [x] 2.4 Create `apps/web/src/app/layout.tsx` — viewport meta, locale resolution via `resolveLocale`
- [x] 2.5 Create `apps/web/src/app/page.tsx` — renders localised strings; `rem`/`%` units; no horizontal overflow at 375px

## Phase 3: API Health Endpoint (TDD)

- [x] 3.1 RED: Write failing test for `GET /health` using Fastify `inject()` — assert 200, JSON shape with `status`, `timestamp`, `uptime`
- [x] 3.2 GREEN: Implement `apps/api/src/routes/health.ts` — returns `{ status: "ok", timestamp, uptime }`
- [x] 3.3 GREEN: Create `apps/api/src/index.ts` — Fastify instance, register health plugin, listen on :4000
- [x] 3.4 Add `EADDRINUSE` graceful error handling — log to stderr, web process continues

## Phase 4: Integration & Guards

- [x] 4.1 Configure root `pnpm dev` using `concurrently` — web :3000 + api :4000
- [x] 4.2 Configure root `pnpm build` and `pnpm type-check` with `pnpm -r` filtered commands; fail-fast on errors
- [x] 4.3 Write dependency guard script — grep workspace `package.json` files for prohibited deps (db, auth, stripe, ai, docker, capacitor); fail if found
- [x] 4.4 Run `pnpm install`, verify workspace resolution, confirm no peer dependency errors
