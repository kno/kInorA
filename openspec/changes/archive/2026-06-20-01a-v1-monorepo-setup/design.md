# Design: 01a V1 Monorepo Setup

## Technical Approach

Scaffold a pnpm workspace with three areas (`apps/web`, `apps/api`, `packages/contracts`), root scripts, version-pinned tooling, a responsive Next.js landing page with EN/ES i18n, a Fastify `/health` endpoint, and shared `@kinora/contracts` types. Implementation stays strictly within the 01a baseline — no DB, auth, Stripe, AI, Docker, CI, PWA, or Capacitor. Architectural layering deferred to `01b-v1`.

Baseline versions verified at design time: Node.js `24.17.0` LTS (`Krypton`), Next.js `16.2.9` (latest stable; requires Node `>=20.9.0`), React `19.2.7`, and Fastify `5.8.5`. Next.js does not publish an LTS line like Node.js; use latest stable for framework packages and pin the latest active Node.js LTS for runtime/tooling.

Maps to the proposal's approach (thin baseline) and delta spec's added requirements for mobile-aware rendering, i18n resolution, capability guards, and concurrent dev commands.

## Architecture Decisions

| Decision | Choice | Considered Alternatives | Rationale |
|----------|--------|------------------------|-----------|
| Workspace manager | pnpm workspaces | npm workspaces, turborepo | Already declared in README; pnpm enforces strict dependency isolation |
| Node runtime | Node.js 24.17.0 LTS (`Krypton`) | Node 22 LTS, non-LTS Node 26 | Latest active LTS at design time and satisfies Next.js engine requirements |
| Web framework | Next.js 16.2.9 App Router | Pages Router, Vite + React | README stack; latest stable Next.js at design time; App Router enables server-component i18n without extra deps |
| API server | Fastify 5.8.5 | Express, Hono | README stack; latest stable Fastify at design time; plugin system + TS-native types fit future architecture |
| i18n approach | Custom JSON + RSC | next-intl, react-intl | Single-page scope (4–5 strings) doesn't justify a library dependency |
| Dev concurrency | `concurrently` | turborepo, npm-run-all | Only 2 processes; turborepo is overkill; concurrently is zero-config |
| TS config | `tsconfig.base.json` + per-workspace extends | Per-workspace only | Avoids duplicating `strict: true`, module resolution, path aliases |
| Version pinning | Exact versions in `package.json` | Range-based (`^`) | Spec requires pinned baseline; exact versions ensure reproducible installs |
| Mobile | Viewport meta + `rem`/`%` units | CSS framework (Tailwind) | One page doesn't need a framework; viewport meta is mandatory for 375px rendering |
| Ports | Web `:3000`, API `:4000` | Random/auto ports | Confirmed convention; predictable URLs for dev and health checks |
| API port fallback | Fastify `listen` catches `EADDRINUSE` | Port checking library | Native Fastify error handling; graceful message to stderr, web continues |
| Root build/test | `pnpm -r` filtered by workspace, fail-fast on errors | Custom shell scripts | `pnpm --filter` handles ordering; failing builds must propagate non-zero exit codes |

## Data Flow

```
Browser                          Fastify (apps/api)
  │ GET /health                    │
  └───────────────────────────────►└─► returns JSON 200
                                     { status: "ok", timestamp, uptime }

Browser                          Next.js (apps/web)
  │ GET / (?lang=es)               │
  └───────────────────────────────►├─► resolveLocale('Accept-Language', 'es')
                                   │    → 'es' (lang param wins)
                                   ├─► renders: layout → page with es.json
                                   └─► HTML response

apps/api                           packages/contracts
  │ import { HealthResponse } ────►│
  └─► type-checks against shared  └─► src/index.ts exports types
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `pnpm-workspace.yaml` | Create | Declares `apps/*`, `packages/*` as workspace directories |
| `package.json` | Create | Root scripts: `dev` (concurrently web+api), `build`, `type-check`, `test`; `engines.node` pins Node.js 24.17.0 LTS compatibility |
| `.node-version` | Create | Pins local runtime to Node.js `24.17.0` LTS |
| `tsconfig.base.json` | Create | Strict TS config: `strict: true`, ESNext module, path aliases |
| `.npmrc` | Create | `shamefully-hoist=false`, `strict-peer-dependencies=true` |
| `apps/web/package.json` | Create | Next.js 16.2.9, React 19.2.7, TypeScript — exact versions |
| `apps/web/tsconfig.json` | Create | Extends `tsconfig.base.json`, adds `jsx: preserve`, next-env |
| `apps/web/next.config.ts` | Create | Minimal config; no i18n plugin (custom approach) |
| `apps/web/src/app/layout.tsx` | Create | Root layout: viewport meta, i18n locale resolution, renders children |
| `apps/web/src/app/page.tsx` | Create | Landing page reading translated strings per resolved locale |
| `apps/web/src/i18n/messages/en.json` | Create | English: title, subtitle, cta |
| `apps/web/src/i18n/messages/es.json` | Create | Spanish: title, subtitle, cta |
| `apps/web/src/i18n/locale.ts` | Create | `resolveLocale`: reads `Accept-Language` + `?lang=`, falls back to `en` |
| `apps/web/public/` | Create | Static assets directory |
| `apps/api/package.json` | Create | Fastify 5.8.5, TypeScript, `tsx` for dev runner |
| `apps/api/tsconfig.json` | Create | Extends base, `outDir: dist`, includes `src/` |
| `apps/api/src/index.ts` | Create | Server entry: creates Fastify instance, registers health plugin, listens |
| `apps/api/src/routes/health.ts` | Create | Fastify plugin: `GET /health` → `{ status: "ok", timestamp, uptime }` |
| `packages/contracts/package.json` | Create | `name: "@kinora/contracts"`, `exports: ./src/index.ts` |
| `packages/contracts/tsconfig.json` | Create | Extends base, `composite: true` for project references |
| `packages/contracts/src/index.ts` | Create | Exports `HealthResponse` and other shared types |
| `.gitignore` | Modify | Add `node_modules/`, `.next/`, `dist/`, `.env*` |

## Interfaces / Contracts

```typescript
// packages/contracts/src/index.ts  — shared types between all workspaces
export interface HealthResponse {
  status: 'ok';
  timestamp: string;   // ISO 8601
  uptime: number;      // seconds since server start
}
```

```typescript
// apps/web/src/i18n/locale.ts      — i18n locale resolution contract
type SupportedLocale = 'en' | 'es';
type Messages = Record<string, string>;

function resolveLocale(
  acceptLanguage: string | null,
  langParam: string | null
): SupportedLocale;  // langParam wins if valid; else Accept-Language match; fallback 'en'

function loadMessages(locale: SupportedLocale): Messages;
```

Fastify plugin interface for health route — zero-config registration: `app.register(healthRoute)`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Type | All workspaces | `pnpm type-check` → `tsc --noEmit` across every package |
| Unit | `resolveLocale` | Vitest: header parsing, `lang` override, unsupported fallback, edge cases |
| Integration | Fastify health route | Fastify `inject()`: assert status 200, JSON shape with `status`, `timestamp`, `uptime` |
| Dependency | Guard audit | Script that greps `package.json` for prohibited deps (db, auth, stripe, ai, docker, capacitor) — fail if found |
| E2E (manual) | Page render at 375px | Dev start → browser resize → no horizontal overflow |

## Migration / Rollout

No migration required. Greenfield scaffold. Existing `.gitignore` updated for monorepo. First `pnpm install` resolves all workspaces.

## Open Questions

- None.
