/**
 * Test-environment stub for the `server-only` package.
 *
 * The real `server-only` always throws so Next.js can fail at build time when
 * a Client Component tries to import a server-only module. In Vitest that
 * throw would break any test that uses `vi.importActual` on a server-only
 * module. This empty stub is wired via the `resolve.alias` in vitest.config.ts
 * so the import becomes a no-op — the guard is enforced at build time by
 * `next build`, not by Vitest.
 */
export {};
