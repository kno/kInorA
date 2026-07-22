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
import os from "node:os";

const CONTAINER_NAME = "kinora-e2e-pg";
export const PG_IMAGE = "pgvector/pgvector:pg17";
const PG_DB = "kinora";
const PG_USER = "kinora";
const PG_PASSWORD = "kinora";
const PG_PORT = process.env.E2E_PG_PORT ?? "5433";
// Dedicated var so an unrelated inherited PORT (e.g. a shell default) cannot
// silently repoint the api server. The container name + these fixed ports
// scope this to ONE E2E run per machine, which is all the suite needs.
const API_PORT = process.env.E2E_API_PORT ?? "4000";
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 1_000;
// Forced-kill grace period before SIGKILLing a survivor Playwright child during
// teardown (signal or startup-failure paths). Matches the spec's 5-second bound.
const FORCE_KILL_TIMEOUT_MS = 5_000;
// Overall Playwright runtime bound. Override with E2E_TIMEOUT_MS when a suite
// needs more time, but never allow an invalid value to remove the safety bound.
const DEFAULT_E2E_TIMEOUT_MS = 15 * 60 * 1_000;
// Default V8 heap cap (MB) for the Playwright webServers, mirrored from
// playwright.config.ts so the run-start log can print the effective value
// without importing the TS config.
const DEFAULT_NODE_MEMORY_MB = 2048;
// Docker resource flags attempted atomically; retried unconstrained only for a
// bounded exit-125 + unsupported-option classifier.
const DOCKER_MEMORY_FLAG = "--memory=1g";
const DOCKER_CPUS_FLAG = "--cpus=1";

/** Run a command synchronously, returning the spawnSync result. */
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

/**
 * Resolve a value that can be awaited independently and resolved from outside.
 * Used for the `signalReceived` awaitable in the teardown state machine so the
 * signal-aware child-wait race can resolve the moment a signal is recorded.
 */
export function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Compute the default Playwright worker count for the current environment.
 * Local default is `2`; CI default is `Math.min(2, os.cpus().length)` so small
 * runners cannot over-provision. Pure function — pass CI and cpu count
 * explicitly so unit tests do not need to mock `os.cpus()` / `process.env`.
 *
 * @param {{ CI?: string | undefined, cpus: number }} input
 * @returns {number}
 */
export function defaultWorkers({ CI, cpus }) {
  if (CI) {
    return Math.min(2, Math.max(1, cpus));
  }
  return 2;
}

/**
 * Parse the `--workers` CLI flag from `args`. Accepts both `--workers=N` and
 * `--workers N` forms. Returns `null` when no flag is present (use the config
 * default). Throws on a bare flag, a missing value, or a value that is not a
 * positive integer (zero, negative, non-numeric). The orchestrator catches the
 * throw and exits non-zero with the message — the spec requires a clear error
 * and non-zero exit, not a silent fallback.
 *
 * @param {string[]} args
 * @returns {number | null}
 */
export function parseWorkers(args) {
  const token = args.find(
    (arg) => arg === "--workers" || arg.startsWith("--workers="),
  );
  if (token === undefined) return null;
  const idx = args.indexOf(token);
  let raw;
  if (token.includes("=")) {
    raw = token.slice(token.indexOf("=") + 1);
  } else {
    raw = args[idx + 1];
  }
  if (raw === undefined) {
    throw new Error(
      `[e2e] Invalid --workers value: bare flag with no value. Must be a positive integer.`,
    );
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `[e2e] Invalid --workers value: "${raw}". Must be a positive integer.`,
    );
  }
  return n;
}

/**
 * Resolve the effective V8 heap cap (MB) for the Playwright webServers. Used
 * for run-start observability. Non-numeric or non-positive values fall back to
 * 2048 so a typo cannot disable the cap silently. Mirrors the same logic in
 * playwright.config.ts.
 *
 * @param {string | undefined} raw
 * @returns {number}
 */
export function nodeMemoryCap(raw = process.env.E2E_NODE_MEMORY) {
  const parsed = raw === undefined ? DEFAULT_NODE_MEMORY_MB : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_NODE_MEMORY_MB;
  }
  return Math.floor(parsed);
}

/** Resolve the bounded overall Playwright timeout in milliseconds. */
export function e2eTimeoutMs(raw = process.env.E2E_TIMEOUT_MS) {
  const parsed = raw === undefined ? DEFAULT_E2E_TIMEOUT_MS : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || Math.floor(parsed) < 1) {
    return DEFAULT_E2E_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

/**
 * Detect an available container runtime. Prefers a real `docker` binary, then
 * falls back to `podman`. Probes by running `<cmd> --version` so a shell alias
 * (which child processes never see) cannot fool the detection.
 */
function detectRuntime() {
  // Explicit override wins (e.g. force one runtime in CI or odd setups).
  if (process.env.CONTAINER_RUNTIME) {
    return process.env.CONTAINER_RUNTIME;
  }
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

/**
 * Classify a `docker/podman run` constrained-attempt failure as a recoverable
 * unsupported-resource-flag signature. Returns true ONLY when all of:
 *   - exit status === 125 (Docker daemon runtime/CLI error code)
 *   - stderr matches an unsupported-option signature (`unknown flag`,
 *     `unknown option`, `flag provided but not defined`, or
 *     `unrecognized option`)
 *   - stderr also mentions `--memory` or `--cpus` (so imagepull/auth/port/
 *     daemon/invalid-arg errors with exit 125 do NOT fall back)
 * Image pull/auth, port conflict, invalid image, daemon-unavailable, generic
 * invalid argument, and all other failures propagate without retry.
 *
 * @param {{ status: number, stdout?: string, stderr?: string }} result
 * @returns {boolean}
 */
export function isUnsupportedResourceFlagsFailure(result) {
  const stderr = result.stderr ?? "";
  if (result.status !== 125) return false;
  if (!/unknown flag|unknown option|flag provided but not defined|unrecognized option/i.test(stderr)) {
    return false;
  }
  return /--memory|--cpus/.test(stderr);
}

/**
 * Human-readable reason for an unsupported-resource-flag fallback. Surfaces the
 * relevant stderr line and the resource-flag identity so the run-start log can
 * record WHY the constraint was dropped while still proposing exactly one retry.
 *
 * @param {{ status: number, stdout?: string, stderr?: string }} result
 * @returns {string}
 */
export function fallbackReason(result) {
  const stderr = result.stderr ?? "";
  const matches = stderr
    .split(/\r?\n/)
    .filter((line) => /--memory|--cpus/.test(line));
  const tail = matches.length > 0 ? matches[matches.length - 1] : stderr.trim();
  return tail || `unsupported Docker resource flags (exit ${result.status})`;
}

/** Create the E2E teardown lifecycle with injected process operations. */
export function createLifecycle(deps) {
  const signalReceived = makeDeferred();
  const abortController = new AbortController();
  let state = "starting";
  let child = null;
  let childExit = null;
  let receivedSignal = null;
  let terminationSignal = null;
  let timedOut = false;
  let signalExitCode = null;
  let startupFailureCode = null;
  let normalExitCode = null;
  let primaryExitCode = null;
  let teardownPromise = null;
  const cleanupErrors = [];

  const guardedStage = async (stage, operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push({ stage, error });
      console.error(
        `[e2e] Cleanup failed at ${stage}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const selectPrimaryExitCode = () => {
    if (receivedSignal === "SIGINT") return 130;
    if (receivedSignal === "SIGTERM") return 143;
    if (timedOut) return 124;
    if (startupFailureCode !== null) return startupFailureCode;
    return normalExitCode ?? 1;
  };

  const waitAndForceKillChild = async () => {
    if (!child) return;
    if (terminationSignal) {
      await guardedStage("signal-forwarding", () =>
        deps.forwardSignal(child, terminationSignal),
      );
    }
    await guardedStage("child-exit-wait", () =>
      deps.waitChildExit(child, deps.forceKillTimeoutMs ?? FORCE_KILL_TIMEOUT_MS),
    );
    await guardedStage("timeout-forced-kill", async () => {
      if (!deps.isChildExited(child)) await deps.killSurvivors(child);
    });
  };

  const teardownOnce = () => {
    if (teardownPromise) return teardownPromise;
    const teardownStartState = state;
    state = "exiting";
    teardownPromise = (async () => {
      try {
        if (teardownStartState === "running" && childExit) {
          await guardedStage("signal-aware-child-wait", async () => {
            const outcome = await Promise.race([
              childExit.then((code) => ({ kind: "child", code })),
              signalReceived.promise.then((signal) => ({ kind: "signal", signal })),
            ]);
            if (outcome.kind === "child" && receivedSignal === null) {
              normalExitCode = outcome.code;
            }
          });
        }
        await waitAndForceKillChild();
        await guardedStage("web-server-cleanup", deps.webServerCleanup);
        await guardedStage("postgres-removal", deps.removePostgres);
        primaryExitCode = selectPrimaryExitCode();
        return primaryExitCode;
      } finally {
        state = "cleaned";
      }
    })();
    return teardownPromise;
  };

  return {
    get state() {
      return state;
    },
    get receivedSignal() {
      return receivedSignal;
    },
    get signalExitCode() {
      return signalExitCode;
    },
    get abortSignal() {
      return abortController.signal;
    },
    get startupFailureCode() {
      return startupFailureCode;
    },
    get primaryExitCode() {
      return primaryExitCode;
    },
    cleanupErrors,
    getChild: () => child,
    setChild(nextChild, exitPromise) {
      child = nextChild;
      childExit = exitPromise;
    },
    markRunning() {
      if (state === "starting") state = "running";
    },
    setNormalExitCode(code) {
      normalExitCode = code;
    },
    recordSignal(signal) {
      receivedSignal = signal;
      terminationSignal = signal;
      signalExitCode = signal === "SIGINT" ? 130 : 143;
      abortController.abort();
      signalReceived.resolve(signal);
    },
    recordTimeout() {
      if (timedOut || receivedSignal) return;
      timedOut = true;
      terminationSignal = "SIGTERM";
      abortController.abort();
      signalReceived.resolve(terminationSignal);
    },
    selectPrimaryExitCode,
    teardownOnce,
    failDuringStartup(error) {
      if (state === "starting") {
        startupFailureCode = Number.isInteger(error?.exitCode)
          ? error.exitCode
          : 1;
      }
      return teardownOnce();
    },
  };
}

/** Start the ephemeral Postgres container detached. */
export function startPostgresWith(
  runtime,
  runCommand = run,
  log = console.log,
) {
  const envArgs = [
    "-e",
    `POSTGRES_DB=${PG_DB}`,
    "-e",
    `POSTGRES_USER=${PG_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-p",
    `${PG_PORT}:5432`,
  ];
  // Attempt the constrained launch atomically — either both --memory and
  // --cpus apply, or neither does. This avoids a partial-flag state where one
  // resource cap works but another is silently dropped by the runtime.
  const constrained = runCommand(runtime, [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    DOCKER_MEMORY_FLAG,
    DOCKER_CPUS_FLAG,
    ...envArgs,
    PG_IMAGE,
  ]);
  if (constrained.status === 0) {
    return;
  }
  if (isUnsupportedResourceFlagsFailure(constrained)) {
    // Exactly ONE unconstrained retry — and only for the bounded exit-125 +
    // unsupported-option + resource-flag classifier logged below.
    const reason = fallbackReason(constrained);
    log(
      `[e2e] Docker resource flags unsupported; retrying unconstrained: ${reason}`,
    );
    const baseArgs = [
      "run",
      "-d",
      "--name",
      CONTAINER_NAME,
      ...envArgs,
      PG_IMAGE,
    ];
    const fallback = runCommand(runtime, baseArgs);
    if (fallback.status !== 0) {
      throw new Error(
        `Failed to start Postgres container:\n${fallback.stderr || fallback.stdout}`,
      );
    }
    return;
  }
  // Any other failure (image pull, auth, port conflict, daemon unavailable,
  // generic invalid argument, wrong status) propagates without retry.
  throw new Error(
    `Failed to start Postgres container:\n${constrained.stderr || constrained.stdout}`,
  );
}

export function formatRunStartLog(workers, memoryMb) {
  return `[e2e] Running Playwright (workers=${workers}, node_memory=${memoryMb} MB)...`;
}

/** Poll `pg_isready` inside the container until ready or timeout. */
export async function waitForPostgres(runtime, options = {}) {
  const signal = options.signal;
  const runCommand = options.runCommand ?? run;
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error("E2E startup aborted");
  };
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    throwIfAborted();
    const probe = runCommand(runtime, [
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
    if (signal) {
      await Promise.race([
        sleep(READY_POLL_MS),
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("E2E startup aborted")), { once: true }),
        ),
      ]);
    } else {
      await sleep(READY_POLL_MS);
    }
  }
  throw new Error(
    `Postgres did not become ready within ${READY_TIMEOUT_MS}ms`,
  );
}

/** Build the environment injected into migrations and Playwright. */
export function stackEnv() {
  return {
    ...process.env,
    DATABASE_URL: `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`,
    API_BASE_URL: `http://localhost:${API_PORT}`,
    PORT: API_PORT,
    NODE_ENV: "test",
  };
}

/**
 * Build the workspace libraries the api and web servers depend on. Both dev
 * servers import `@kinora/contracts`, `@kinora/domain`, and `@kinora/i18n`
 * (the web layout/i18n request config) through their published `dist/` entry
 * points, which only exist after a `tsc` build — Next resolves these packages
 * via their "default" export (no `transpilePackages`). CI runs the "Build"
 * step AFTER e2e (and a fresh clone has no dist at all), so the webServer would
 * fail to start with "Module not found: Can't resolve '@kinora/i18n'" unless we
 * build these first. Keeps `pnpm test:e2e` self-contained.
 */
async function buildWorkspaceLibs(env, signal) {
  const code = await runInherit(
    "pnpm",
    [
      "--filter",
      "@kinora/contracts",
      "--filter",
      "@kinora/domain",
      "--filter",
      "@kinora/i18n",
      "build",
    ],
    env,
    signal,
  );
  if (code !== 0) {
    throw Object.assign(
      new Error(`Workspace library build failed with exit code ${code}`),
      { exitCode: code },
    );
  }
}

/** Run a command, inheriting stdio, and resolve with its exit code. */
export function runInherit(cmd, args, env, signal) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env, signal });
    // If the binary is missing from PATH, Node emits 'error' and never 'close';
    // resolve with a non-zero code so the run fails fast instead of hanging.
    child.on("error", (err) => {
      console.error(`[e2e] Failed to spawn ${cmd}: ${err.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Start Playwright in its own process group and expose its exit immediately. */
function startPlaywright(args, env) {
  const child = spawn("pnpm", ["exec", "playwright", "test", ...args], {
    stdio: "inherit",
    env,
    detached: process.platform !== "win32",
  });
  let settled = false;
  const started = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const exit = new Promise((resolve) => {
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      console.error(`[e2e] Failed to spawn Playwright: ${error.message}`);
      resolve(1);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      resolve(code ?? 1);
    });
  });
  return { child, started, exit };
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("close", onClose);
      reject(new Error(`child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("close", onClose);
  });
}

function signalChildGroup(child, signal) {
  if (childExited(child)) return;
  if (process.platform === "win32" || !child.pid) {
    child.kill(signal);
    return;
  }
  process.kill(-child.pid, signal);
}

function killChildGroup(child) {
  signalChildGroup(child, "SIGKILL");
}

async function main() {
  // Validate `--workers` early so a bad value fails fast before Docker startup.
  // parseWorkers returns null when no flag is present (use Playwright config
  // default) or a positive integer when the user passed --workers=N / --workers N.
  // It throws on a bare flag, missing value, zero, negative, or non-numeric.
  const argv = process.argv.slice(2);
  let workersOverride = null;
  try {
    workersOverride = parseWorkers(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const runtime = detectRuntime();
  if (!runtime) {
    console.error(
      "No container runtime found. Install Docker or Podman to run E2E tests.",
    );
    return 1;
  }
  console.log(`[e2e] Using container runtime: ${runtime}`);

  const env = stackEnv();
  let childExit = null;
  let playwrightChild = null;
  let playwrightTimeout = null;
  const lifecycle = createLifecycle({
    waitChildExit: waitForChildExit,
    isChildExited: childExited,
    killSurvivors: killChildGroup,
    forwardSignal: signalChildGroup,
    webServerCleanup: async () => {
      if (playwrightChild) {
        await waitForChildExit(playwrightChild, FORCE_KILL_TIMEOUT_MS);
      }
    },
    removePostgres: () => {
      console.log("[e2e] Tearing down Postgres container...");
      removeExisting(runtime);
    },
  });

  const onSignal = (signal) => {
    lifecycle.recordSignal(signal);
    void lifecycle.teardownOnce();
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const requireStarting = () => {
    if (lifecycle.state !== "starting") {
      throw new Error("E2E startup interrupted by teardown");
    }
  };

  try {
    console.log("[e2e] Removing any stale container...");
    removeExisting(runtime);

    console.log(`[e2e] Starting Postgres (${PG_IMAGE}) on host port ${PG_PORT}...`);
    startPostgresWith(runtime);

    console.log("[e2e] Waiting for Postgres to accept connections...");
     await waitForPostgres(runtime, { signal: lifecycle.abortSignal });
    requireStarting();

    console.log("[e2e] Running database migrations...");
    const migrateCode = await runInherit(
      "pnpm",
      ["--filter", "api", "db:migrate"],
      env,
      lifecycle.abortSignal,
    );
    if (migrateCode !== 0) {
      throw Object.assign(
        new Error(`Migrations failed with exit code ${migrateCode}`),
        { exitCode: migrateCode },
      );
    }
    requireStarting();

    console.log("[e2e] Building workspace libraries (api dependencies)...");
     await buildWorkspaceLibs(env, lifecycle.abortSignal);
    requireStarting();

    const playwrightArgs = buildPlaywrightArgs(argv, workersOverride);
    const effectiveWorkers =
      workersOverride ?? defaultWorkers({ CI: process.env.CI, cpus: os.cpus().length });
    console.log(formatRunStartLog(effectiveWorkers, nodeMemoryCap()));
    const tracked = startPlaywright(playwrightArgs, env);
    playwrightChild = tracked.child;
    childExit = tracked.exit;
    lifecycle.setChild(tracked.child, childExit);
    await tracked.started;
    requireStarting();
    lifecycle.markRunning();
    const timeoutMs = e2eTimeoutMs();
    console.log(`[e2e] Playwright timeout: ${timeoutMs}ms`);
    playwrightTimeout = setTimeout(() => {
      console.error(`[e2e] Playwright exceeded ${timeoutMs}ms; terminating process group.`);
      lifecycle.recordTimeout();
      void lifecycle.teardownOnce();
    }, timeoutMs);
    return await lifecycle.teardownOnce();
  } catch (err) {
    console.error(`[e2e] ${err instanceof Error ? err.message : String(err)}`);
    return await lifecycle.failDuringStartup(err);
  } finally {
    if (playwrightTimeout) clearTimeout(playwrightTimeout);
    await lifecycle.teardownOnce();
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

/**
 * Build the args passed to `pnpm exec playwright test`, normalizing any
 * `--workers` token to a single `--workers=N` form and avoiding double
 * injection. Other args (e.g. `--project=chromium`, file paths) pass through.
 *
 * @param {string[]} argv - raw process.argv.slice(2)
 * @param {number | null} workersOverride - validated worker count, or null
 * @returns {string[]}
 */
export function buildPlaywrightArgs(argv, workersOverride) {
  // Drop every --workers token (and its separated value if present) so the
  // original form never reaches Playwright; we re-inject a normalized flag.
  const cleaned = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workers") {
      // Skip the separated value too, but only if it isn't itself another flag.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--workers=")) {
      continue;
    }
    cleaned.push(arg);
  }
  if (workersOverride !== null) {
    cleaned.push(`--workers=${workersOverride}`);
  }
  return cleaned;
}

// Run only when invoked directly as `node scripts/e2e-with-stack.mjs`, not when
// imported by unit tests. Plain-Node ESM has no `import.meta.main` yet, so use
// the path-equality guard. Side-effecting imports would otherwise spawn Docker.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
