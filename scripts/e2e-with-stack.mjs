#!/usr/bin/env node
// @ts-check
/**
 * Self-contained E2E stack orchestrator.
 *
 * Playwright starts its `webServer` processes (api + web) BEFORE `globalSetup`
 * runs, so the database must already be up and migrated before Playwright
 * launches. This script owns that lifecycle:
 *
 *   1. Detect a container runtime (real `docker` binary preferred, else
 *      `podman`). A shell alias `docker=podman` is invisible to child
 *      processes, so we probe the actual binaries.
 *   2. Start an ephemeral Postgres 17 container on a non-default host port
 *      (default 5433, override via `E2E_PG_PORT`) — host 5432 is frequently
 *      occupied (e.g. podman's gvproxy).
 *   3. Poll `pg_isready` until the database accepts connections.
 *   4. Run Drizzle migrations against that database.
 *   5. Run `playwright test`, passing through any CLI args, with the stack
 *      connection details injected into the child environment. The api dev
 *      server (a Playwright webServer) inherits `DATABASE_URL`/`PORT`; the web
 *      dev server reaches the api via `API_BASE_URL`.
 *   6. Always tear the container down (finally + signal handlers) and exit
 *      with Playwright's exit code.
 *
 * Plain Node ESM — no TypeScript, no build step — so `pnpm test:e2e` works
 * identically locally and in CI.
 */

import { spawn, spawnSync } from "node:child_process";

const CONTAINER_NAME = "kinora-e2e-pg";
const PG_IMAGE = "postgres:17-alpine";
const PG_DB = "kinora";
const PG_USER = "kinora";
const PG_PASSWORD = "kinora";
const PG_PORT = process.env.E2E_PG_PORT ?? "5433";
const API_PORT = process.env.PORT ?? "4000";
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 1_000;

/** Run a command synchronously, returning the spawnSync result. */
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

/**
 * Detect an available container runtime. Prefers a real `docker` binary, then
 * falls back to `podman`. Probes by running `<cmd> --version` so a shell alias
 * (which child processes never see) cannot fool the detection.
 */
function detectRuntime() {
  for (const candidate of ["docker", "podman"]) {
    const probe = run(candidate, ["--version"]);
    if (probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

/** Remove any pre-existing container of our name (ignore errors). */
function removeExisting(runtime) {
  run(runtime, ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
}

/** Start the ephemeral Postgres container detached. */
function startPostgres(runtime) {
  const result = run(runtime, [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "-e",
    `POSTGRES_DB=${PG_DB}`,
    "-e",
    `POSTGRES_USER=${PG_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-p",
    `${PG_PORT}:5432`,
    PG_IMAGE,
  ]);
  if (result.status !== 0) {
    throw new Error(
      `Failed to start Postgres container:\n${result.stderr || result.stdout}`,
    );
  }
}

/** Poll `pg_isready` inside the container until ready or timeout. */
async function waitForPostgres(runtime) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const probe = run(runtime, [
      "exec",
      CONTAINER_NAME,
      "pg_isready",
      "-U",
      PG_USER,
      "-d",
      PG_DB,
    ]);
    if (probe.status === 0) {
      return;
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(
    `Postgres did not become ready within ${READY_TIMEOUT_MS}ms`,
  );
}

/** Build the environment injected into migrations and Playwright. */
function stackEnv() {
  return {
    ...process.env,
    DATABASE_URL: `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`,
    API_BASE_URL: `http://localhost:${API_PORT}`,
    PORT: API_PORT,
    NODE_ENV: "test",
  };
}

/** Run a command, inheriting stdio, and resolve with its exit code. */
function runInherit(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const runtime = detectRuntime();
  if (!runtime) {
    console.error(
      "No container runtime found. Install Docker or Podman to run E2E tests.",
    );
    process.exit(1);
  }
  console.log(`[e2e] Using container runtime: ${runtime}`);

  const env = stackEnv();
  let exitCode = 1;
  let torn = false;

  const teardown = () => {
    if (torn) return;
    torn = true;
    console.log("[e2e] Tearing down Postgres container...");
    removeExisting(runtime);
  };

  // Ensure teardown on interrupts as well as normal completion.
  const onSignal = (signal) => {
    teardown();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  try {
    console.log("[e2e] Removing any stale container...");
    removeExisting(runtime);

    console.log(`[e2e] Starting Postgres (${PG_IMAGE}) on host port ${PG_PORT}...`);
    startPostgres(runtime);

    console.log("[e2e] Waiting for Postgres to accept connections...");
    await waitForPostgres(runtime);

    console.log("[e2e] Running database migrations...");
    const migrateCode = await runInherit(
      "pnpm",
      ["--filter", "api", "db:migrate"],
      env,
    );
    if (migrateCode !== 0) {
      throw new Error(`Migrations failed with exit code ${migrateCode}`);
    }

    console.log("[e2e] Running Playwright...");
    const args = process.argv.slice(2);
    exitCode = await runInherit("pnpm", ["exec", "playwright", "test", ...args], env);
  } catch (err) {
    console.error(`[e2e] ${err instanceof Error ? err.message : String(err)}`);
    exitCode = 1;
  } finally {
    teardown();
  }

  process.exit(exitCode);
}

main();
