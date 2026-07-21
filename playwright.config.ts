import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';

const apiPort = process.env.E2E_API_PORT ?? '4000';
const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${apiPort}`;
const pwaProduction = process.env.E2E_PWA_PRODUCTION === 'true';
const webCommand = pwaProduction
  ? 'pnpm --filter web build && pnpm --filter web start --hostname 127.0.0.1 --port 3000'
  : 'pnpm --filter web dev --hostname 127.0.0.1 --port 3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Bound Playwright workers so the suite is host-safe on 8–16 GB machines.
  // Local default is 2; CI is capped at Math.min(2, os.cpus().length) so small
  // runners cannot over-provision. An explicit `--workers=N` passed to
  // `pnpm test:e2e` (orchestrated by scripts/e2e-with-stack.mjs) overrides this
  // at the CLI level. These are resource-safety controls, not RSS guarantees.
  workers: process.env.CI ? Math.min(2, os.cpus().length) : 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  // Two web servers: the api (Fastify) first, then web (Next.js). The api
  // inherits DATABASE_URL/PORT from the e2e-with-stack.mjs orchestrator, which
  // also brings up and migrates Postgres BEFORE Playwright launches (Playwright
  // starts webServer entries before globalSetup, so the DB cannot be started
  // here). The web server reaches the api via API_BASE_URL.
  webServer: [
    {
      command: 'pnpm --filter api dev',
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Scoped V8 heap cap (NOT an RSS ceiling) for the api dev server only.
        // E2E_NODE_MEMORY overrides the cap; the parent shell NODE_OPTIONS is
        // untouched because Playwright merges webServer.env into the child env
        // alone.
        NODE_OPTIONS: `--max-old-space-size=${nodeMemoryCap()}`,
        PORT: apiPort,
      },
    },
    {
      command: webCommand,
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: pwaProduction ? false : !process.env.CI,
      timeout: 120_000,
      env: {
        API_BASE_URL: apiBaseUrl,
        NODE_OPTIONS: `--max-old-space-size=${nodeMemoryCap()}`,
      },
    },
  ],
  projects: [
    pwaProduction
      ? {
          name: 'pwa-production',
          testMatch: '**/pwa.spec.ts',
          use: { ...devices['Desktop Chrome'] },
        }
      : {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
  ],
});

/**
 * V8 heap cap (MB) applied to each Playwright webServer child via scoped
 * `NODE_OPTIONS`. Defaults to 2048; overridable via `E2E_NODE_MEMORY`. A
 * non-numeric or empty value falls back to 2048 so a typo cannot disable the
 * cap silently. This caps the V8 old-space heap only — process RSS may still
 * exceed it due to native allocations, JIT, and runtime overhead.
 */
function nodeMemoryCap(): string {
  const raw = process.env.E2E_NODE_MEMORY;
  const parsed = raw === undefined ? 2048 : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '2048';
  }
  return String(Math.floor(parsed));
}
