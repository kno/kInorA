# Apply Progress: 01a V1 Monorepo Setup

**Mode**: Strict TDD
**Delivery**: size:exception (single PR, ~500 lines, maintainer-approved)
**Status**: All tasks complete

## Completed Tasks

### Phase 1: Foundation
- [x] 1.1 Create `pnpm-workspace.yaml` declaring `apps/*` and `packages/*`
- [x] 1.2 Create root `package.json` — `dev`, `build`, `type-check`, `test` scripts; `engines.node` ≥24.17.0; exact versions
- [x] 1.3 Create `.node-version` pinning Node.js 24.17.0
- [x] 1.4 Create `tsconfig.base.json` — `strict: true`, ESNext module, path aliases
- [x] 1.5 Create `.npmrc` — `shamefully-hoist=false`, `strict-peer-dependencies=true`
- [x] 1.6 Create `packages/contracts/src/index.ts` exporting `HealthResponse` type + `package.json` (`@kinora/contracts`) + `tsconfig.json`
- [x] 1.7 Create `apps/web/package.json` (Next.js 16.2.9, React 19.2.7, exact) + `tsconfig.json` + `next.config.ts` + `public/`
- [x] 1.8 Create `apps/api/package.json` (Fastify 5.8.5, tsx, exact) + `tsconfig.json`
- [x] 1.9 Update `.gitignore` — add `node_modules/`, `.next/`, `dist/`, `.env*`

### Phase 2: i18n & Web Page (TDD)
- [x] 2.1 RED: Write failing test for `resolveLocale`
- [x] 2.2 GREEN: Implement `apps/web/src/i18n/locale.ts`
- [x] 2.3 Create `apps/web/src/i18n/messages/en.json` and `es.json`
- [x] 2.4 Create `apps/web/src/app/layout.tsx` — viewport meta, locale resolution
- [x] 2.5 Create `apps/web/src/app/page.tsx` — renders localised strings

### Phase 3: API Health Endpoint (TDD)
- [x] 3.1 RED: Write failing test for `GET /health`
- [x] 3.2 GREEN: Implement `apps/api/src/routes/health.ts`
- [x] 3.3 GREEN: Create `apps/api/src/index.ts`
- [x] 3.4 Add `EADDRINUSE` graceful error handling

### Phase 4: Integration & Guards
- [x] 4.1 Configure root `pnpm dev` using `concurrently`
- [x] 4.2 Configure root `pnpm build` and `pnpm type-check`
- [x] 4.3 Write dependency guard script
- [x] 4.4 Run `pnpm install`, verify workspace resolution

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1–1.9 | N/A | N/A | N/A (greenfield) | ➖ Skipped: structural | ➖ Skipped: structural | ➖ Skipped: structural | ➖ Skipped: structural |
| 2.1 | `apps/web/src/i18n/__tests__/locale.test.ts` | Unit | N/A (greenfield) | ✅ Written | ✅ Passed | ✅ 8 cases (resolveLocale) + 3 cases (loadMessages) | ✅ Refactored to import from JSON files |
| 2.2 | (same) | Unit | ✅ GREEN passes | ✅ Written | ✅ All 11 pass | ✅ Covered | ✅ Clean |
| 2.3 | (same) | Unit | ✅ Still passes | ➖ Config | ➖ Config | ➖ Skipped: JSON message files have one valid structure | ➖ N/A |
| 2.4 | (same) | Unit | ✅ Still passes | ➖ Structural (RSC) | ➖ Structural (RSC) | ➖ Skipped: layout is config shell, no logic | ➖ N/A |
| 2.5 | (same) | Unit | ✅ Still passes | ➖ Structural (RSC) | ➖ Structural (RSC) | ➖ Skipped: page renders locale content via tested resolveLocale | ➖ N/A |
| 3.1 | `apps/api/src/routes/__tests__/health.test.ts` | Integration | N/A (greenfield) | ✅ Written | ✅ Passed | ✅ 6 cases (200, status, timestamp, uptime, content-type, uptime increase) | ✅ Clean |
| 3.2 | (same) | Integration | ✅ GREEN passes | ✅ Written | ✅ All 6 pass | ✅ Covered | ✅ Clean |
| 3.3 | (same) | Integration | ✅ Still passes | ➖ Structural | ➖ Structural | ➖ Skipped: entry point wiring, logic in health route | ➖ N/A |
| 3.4 | (same) | Integration | ✅ Still passes | ➖ Error handling | ➖ Error handling | ➖ Skipped: EADDRINUSE path requires port contention mocking, tested via manual verification | ➖ N/A |
| 4.1 | N/A | N/A | N/A | ➖ Skipped: root script config | ➖ Skipped: config | ➖ Skipped: config | ➖ N/A |
| 4.2 | N/A | N/A | ✅ pnpm -r build/type-check pass | ➖ Skipped: root script config | ➖ Verified | ➖ Skipped: config | ➖ N/A |
| 4.3 | N/A | N/A | N/A | ➖ Skipped: guard script | ✅ Verified | ➖ Skipped: guard script has no branching logic | ➖ N/A |
| 4.4 | N/A | N/A | ✅ All workspaces resolve | ➖ Verification | ✅ Verified | ➖ Verification step | ➖ N/A |

## Test Summary
- **Total tests written**: 17 (11 locale + 6 health)
- **Total tests passing**: 17
- **Layers used**: Unit (11), Integration (6)
- **Approval tests** (refactoring): None — no refactoring tasks
- **Pure functions created**: `resolveLocale()`, `loadMessages()`, `parseAcceptLanguage()`

## Verification Results
- `pnpm type-check`: ✅ All 3 workspaces pass
- `pnpm test`: ✅ 17 tests pass
- `pnpm build`: ✅ web (Next.js) + api (tsc)
- `pnpm deps-guard`: ✅ No prohibited dependencies