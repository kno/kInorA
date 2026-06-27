import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
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
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter web dev --hostname 127.0.0.1 --port 3000',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:4000',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
