/**
 * Unit tests for the E2E resource-safety orchestrator (scripts/e2e-with-stack.mjs).
 *
 * Strict TDD: tests written FIRST against pure helpers exported from
 * `e2e-with-stack.mjs`. The module is plain ESM guarded by an `isMain` check so
 * importing it never spawns Docker or runs the stack.
 *
 * Layers used: Unit (no runtime boundary here; integration/E2E covered in
 * `pnpm test:e2e`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseWorkers,
  defaultWorkers,
  makeDeferred,
  buildPlaywrightArgs,
  nodeMemoryCap,
  stackEnv,
  isUnsupportedResourceFlagsFailure,
  fallbackReason,
  createLifecycle,
  startPostgresWith,
  formatRunStartLog,
  waitForPostgres,
  runInherit,
} from "../e2e-with-stack.mjs";

/* -------------------------------------------------------------------------- */
/* Shared helpers (task 1.1)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Drive guarded teardown stages with deterministic fakes and a manually
 * controllable clock for the 5-second forced-kill timeout.
 */
function useFakeClock() {
  vi.useFakeTimers().setSystemTime(new Date(0));
  return () => vi.useRealTimers();
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type PlaywrightWebServer = {
  url: string;
  reuseExistingServer?: boolean;
  env?: Record<string, string | undefined>;
};

async function loadPlaywrightWebServers(env: {
  E2E_API_PORT?: string;
  API_BASE_URL?: string;
  E2E_PWA_PRODUCTION?: string;
}): Promise<PlaywrightWebServer[]> {
  vi.stubEnv("E2E_API_PORT", env.E2E_API_PORT);
  vi.stubEnv("API_BASE_URL", env.API_BASE_URL);
  vi.stubEnv("E2E_PWA_PRODUCTION", env.E2E_PWA_PRODUCTION);
  vi.resetModules();
  const { default: config } = await import("../../playwright.config.ts");
  return config.webServer as PlaywrightWebServer[];
}

describe("Playwright API webServer port configuration", () => {
  it("derives the API health URL, API child port, and default API_BASE_URL from E2E_API_PORT", async () => {
    const webServers = await loadPlaywrightWebServers({ E2E_API_PORT: "4317" });

    expect(webServers[0]).toMatchObject({
      url: "http://127.0.0.1:4317/health",
      env: expect.objectContaining({ PORT: "4317" }),
    });
    expect(webServers[1]?.env?.API_BASE_URL).toBe("http://localhost:4317");
  });

  it("preserves an injected API_BASE_URL while E2E_API_PORT controls the API server", async () => {
    const webServers = await loadPlaywrightWebServers({
      E2E_API_PORT: "4318",
      API_BASE_URL: "http://127.0.0.1:4999",
    });

    expect(webServers[0]).toMatchObject({
      url: "http://127.0.0.1:4318/health",
      env: expect.objectContaining({ PORT: "4318" }),
    });
    expect(webServers[1]?.env?.API_BASE_URL).toBe("http://127.0.0.1:4999");
  });

  it("preserves port 4000 as the default when no E2E API environment is injected", async () => {
    const webServers = await loadPlaywrightWebServers({});

    expect(webServers[0]).toMatchObject({
      url: "http://127.0.0.1:4000/health",
      env: expect.objectContaining({ PORT: "4000" }),
    });
    expect(webServers[1]?.env?.API_BASE_URL).toBe("http://localhost:4000");
  });
});

describe("Playwright PWA production mode", () => {
  it("keeps the normal E2E web server on Next dev", async () => {
    const webServers = await loadPlaywrightWebServers({});

    expect(webServers[1]?.command).toContain("pnpm --filter web dev");
    expect(webServers[1]?.command).not.toContain("next build");
  });

  it("builds successfully before starting the production web server", async () => {
    const webServers = await loadPlaywrightWebServers({
      E2E_API_PORT: "4321",
      E2E_PWA_PRODUCTION: "true",
    });

    expect(webServers[1]).toMatchObject({
      command:
        "pnpm --filter web build && pnpm --filter web start --hostname 127.0.0.1 --port 3000",
      url: "http://127.0.0.1:3000",
      env: expect.objectContaining({
        API_BASE_URL: "http://localhost:4321",
      }),
      reuseExistingServer: false,
    });
  });

  it("keeps reuse enabled for normal dev mode but disables it for production PWA mode", async () => {
    const devServers = await loadPlaywrightWebServers({});
    expect(devServers[1]?.reuseExistingServer).toBe(true);

    const productionServers = await loadPlaywrightWebServers({ E2E_PWA_PRODUCTION: "true" });
    expect(productionServers[1]?.reuseExistingServer).toBe(false);
  });

  it("uses a dedicated project for production PWA tests", async () => {
    vi.stubEnv("E2E_PWA_PRODUCTION", "true");
    vi.resetModules();
    const { default: config } = await import("../../playwright.config.ts");

    expect(config.projects).toEqual([
      expect.objectContaining({
        name: "pwa-production",
        testMatch: "**/pwa.spec.ts",
      }),
    ]);
  });

  it("requires the explicit true value and preserves an injected API URL", async () => {
    const devServers = await loadPlaywrightWebServers({
      E2E_PWA_PRODUCTION: "1",
    });
    expect(devServers[1]?.command).toContain("web dev");

    const productionServers = await loadPlaywrightWebServers({
      API_BASE_URL: "http://127.0.0.1:4999",
      E2E_PWA_PRODUCTION: "true",
    });
    expect(productionServers[1]?.command).toContain("web build &&");
    expect(productionServers[1]?.env?.API_BASE_URL).toBe(
      "http://127.0.0.1:4999",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 1.2: parseWorkers()                                                  */
/* -------------------------------------------------------------------------- */

describe("parseWorkers", () => {
  it("accepts --workers=2", () => {
    expect(parseWorkers(["--workers=2"])).toBe(2);
  });

  it("accepts separated --workers 2", () => {
    expect(parseWorkers(["--workers", "2"])).toBe(2);
  });

  it("rejects non-numeric --workers=abc with a throw", () => {
    expect(() => parseWorkers(["--workers=abc"])).toThrowError(/workers/i);
  });

  it("rejects zero --workers=0", () => {
    expect(() => parseWorkers(["--workers=0"])).toThrowError(/workers/i);
  });

  it("rejects negative --workers=-1", () => {
    expect(() => parseWorkers(["--workers=-1"])).toThrowError(/workers/i);
  });

  it("rejects bare --workers (missing value)", () => {
    expect(() => parseWorkers(["--workers"])).toThrowError(/workers/i);
  });

  it("returns null when no --workers flag is present", () => {
    expect(parseWorkers([])).toBeNull();
    expect(parseWorkers(["--project=chromium"])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 1.3: defaultWorkers()                                                */
/* -------------------------------------------------------------------------- */

describe("defaultWorkers", () => {
  it("returns 2 when CI is unset", () => {
    expect(defaultWorkers({ CI: undefined, cpus: 12 })).toBe(2);
  });

  it("returns Math.min(2, cpus) on CI with 1 cpu -> 1", () => {
    expect(defaultWorkers({ CI: "true", cpus: 1 })).toBe(1);
  });

  it("returns Math.min(2, cpus) on CI with 2 cpus -> 2", () => {
    expect(defaultWorkers({ CI: "1", cpus: 2 })).toBe(2);
  });

  it("caps CI at 2 when 4 cpus available", () => {
    expect(defaultWorkers({ CI: "true", cpus: 4 })).toBe(2);
  });

  it("ignores cpus when CI is unset (host stays at 2)", () => {
    expect(defaultWorkers({ CI: undefined, cpus: 1 })).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* buildPlaywrightArgs — normalized injection of --workers into Playwright    */
/* -------------------------------------------------------------------------- */

describe("buildPlaywrightArgs", () => {
  it("re-injects a single --workers=N when override is present", () => {
    expect(buildPlaywrightArgs([], 2)).toEqual(["--workers=2"]);
  });

  it("removes the original --workers=N form and normalizes", () => {
    const argv = ["--workers=4", "--project=chromium", "tests/e2e/foo.spec.ts"];
    expect(buildPlaywrightArgs(argv, 4)).toEqual([
      "--project=chromium",
      "tests/e2e/foo.spec.ts",
      "--workers=4",
    ]);
  });

  it("removes the separated --workers N form and normalizes", () => {
    const argv = ["--workers", "4", "--reporter=list"];
    expect(buildPlaywrightArgs(argv, 4)).toEqual(["--reporter=list", "--workers=4"]);
  });

  it("does not double-inject when --workers was already in argv", () => {
    const argv = ["--workers", "3"];
    const result = buildPlaywrightArgs(argv, 3);
    const workersCount = result.filter((a) => a.startsWith("--workers=")).length;
    expect(workersCount).toBe(1);
  });

  it("passes other args through untouched when no override is present", () => {
    const argv = ["--project=chromium", "tests/e2e/bar.spec.ts"];
    expect(buildPlaywrightArgs(argv, null)).toEqual(argv);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 2.1: NODE_OPTIONS / nodeMemoryCap + stackEnv NO global mutation      */
/* (approval-style: production existed from Phase 1 scaffolding; preserved)  */
/* -------------------------------------------------------------------------- */

describe("nodeMemoryCap", () => {
  beforeEach(() => {
    delete process.env.E2E_NODE_MEMORY;
  });

  it("defaults to 2048 MB when E2E_NODE_MEMORY is unset", () => {
    expect(nodeMemoryCap(undefined)).toBe(2048);
  });

  it("honors E2E_NODE_MEMORY=4096", () => {
    expect(nodeMemoryCap("4096")).toBe(4096);
  });

  it("falls back to 2048 on a non-numeric value", () => {
    expect(nodeMemoryCap("abc")).toBe(2048);
  });

  it("falls back to 2048 on an empty string", () => {
    expect(nodeMemoryCap("")).toBe(2048);
  });

  it("falls back to 2048 on a non-positive value", () => {
    expect(nodeMemoryCap("0")).toBe(2048);
    expect(nodeMemoryCap("-512")).toBe(2048);
  });

  it("floors fractional values", () => {
    expect(nodeMemoryCap("4096.9")).toBe(4096);
  });
});

describe("stackEnv — NO NODE_OPTIONS mutation (spec 8)", () => {
  beforeEach(() => {
    delete process.env.NODE_OPTIONS;
  });

  it("does NOT add NODE_OPTIONS to the parent/injected env", () => {
    const env = stackEnv();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("does NOT override an existing parent NODE_OPTIONS", () => {
    process.env.NODE_OPTIONS = "--enable-source-maps";
    const env = stackEnv();
    // Whatever the parent had passes through verbatim (spread), but stackEnv
    // itself never mutates NODE_OPTIONS — only Playwright's webServer.env does,
    // and only for the child.
    expect(env.NODE_OPTIONS).toBe("--enable-source-maps");
  });

  it("still propagates required stack variables", () => {
    const env = stackEnv();
    expect(env.DATABASE_URL).toContain("postgres://");
    expect(env.API_BASE_URL).toContain("http://localhost:");
    expect(env.PORT).toBe(process.env.E2E_API_PORT ?? "4000");
    expect(env.NODE_ENV).toBe("test");
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 2.3: Docker constraint classifier                                    */
/* -------------------------------------------------------------------------- */

describe("isUnsupportedResourceFlagsFailure", () => {
  it("flags exit 125 + unknown flag --cpus stderr", () => {
    const result = {
      status: 125,
      stderr: "unknown flag: --cpus",
      stdout: "",
    };
    expect(isUnsupportedResourceFlagsFailure(result)).toBe(true);
  });

  it("flags exit 125 + flag provided but not defined --memory", () => {
    expect(
      isUnsupportedResourceFlagsFailure({
        status: 125,
        stderr: "flag provided but not defined: --memory",
        stdout: "",
      }),
    ).toBe(true);
  });

  it("flags exit 125 + unknown option + --memory combination", () => {
    expect(
      isUnsupportedResourceFlagsFailure({
        status: 125,
        stderr: "unknown option `--memory=1g`",
        stdout: "",
      }),
    ).toBe(true);
  });

  it("flags exit 125 + unrecognized option wording", () => {
    expect(
      isUnsupportedResourceFlagsFailure({
        status: 125,
        stderr: "unrecognized option `--cpus=1`",
        stdout: "",
      }),
    ).toBe(true);
  });

  it("rejects wrong status (non-125) even with matching stderr", () => {
    expect(
      isUnsupportedResourceFlagsFailure({
        status: 127,
        stderr: "unknown flag: --cpus",
        stdout: "",
      }),
    ).toBe(false);
  });

  it("rejects exit 0 even with stderr noise", () => {
    expect(
      isUnsupportedResourceFlagsFailure({
        status: 0,
        stderr: "unknown flag: --cpus",
        stdout: "",
      }),
    ).toBe(false);
  });

  it("rejects exit 125 stderr with NO resource-flag mention (image/auth/daemon propagate)", () => {
    expect(
      isUnsupportedResourceFlagsFailure({
        status: 125,
        stderr: "Unable to find image 'postgres:17-alpine' locally",
        stdout: "",
      }),
    ).toBe(false);
  });

  it("rejects exit 125 with port conflict stderr (no flag mention)", () => {
    expect(
      isUnsupportedResourceFlagsFailure({
        status: 125,
        stderr: "bind: address already in use",
        stdout: "",
      }),
    ).toBe(false);
  });

  it("rejects exit 125 with only stdout unsupported-option output (stderr rule)", () => {
    expect(
      isUnsupportedResourceFlagsFailure({
        status: 125,
        stderr: "",
        stdout: "unknown flag: --cpus",
      }),
    ).toBe(false);
  });
});

describe("fallbackReason", () => {
  it("returns a human-readable reason derived from stderr", () => {
    const result = {
      status: 125,
      stderr: "unknown flag: --cpus",
      stdout: "ignored",
    };
    const reason = fallbackReason(result);
    expect(reason).toContain("unknown flag: --cpus");
  });

  it("includes the resource flag identity", () => {
    const result = {
      status: 125,
      stderr: "flag provided but not defined: --memory",
      stdout: "",
    };
    const reason = fallbackReason(result);
    expect(reason).toContain("--memory");
  });

  it("still produces a non-empty reason for empty stderr (classifier boundary)", () => {
    const reason = fallbackReason({ status: 125, stderr: "", stdout: "" });
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
  });
});

describe("startPostgresWith", () => {
  it("attempts both resource constraints atomically in one launch", () => {
    const runCommand = vi.fn(() => ({ status: 0, stdout: "id", stderr: "" }));
    startPostgresWith("docker", runCommand, vi.fn());
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["--memory=1g", "--cpus=1"]),
    );
  });

  it("retries exactly once without constraints for the bounded classifier", () => {
    const runCommand = vi
      .fn()
      .mockReturnValueOnce({ status: 125, stdout: "", stderr: "unknown flag: --cpus" })
      .mockReturnValueOnce({ status: 0, stdout: "id", stderr: "" });
    const log = vi.fn();
    startPostgresWith("docker", runCommand, log);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand.mock.calls[1]?.[1]).not.toEqual(
      expect.arrayContaining(["--memory=1g", "--cpus=1"]),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("unknown flag: --cpus"));
  });

  it("propagates unrelated launch failures without retry", () => {
    const runCommand = vi.fn(() => ({
      status: 125,
      stdout: "",
      stderr: "bind: address already in use",
    }));
    expect(() => startPostgresWith("docker", runCommand, vi.fn())).toThrow(
      /address already in use/,
    );
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});

describe("startup cancellation", () => {
  it("aborts Postgres readiness polling without waiting for the 30-second deadline", async () => {
    const controller = new AbortController();
    const runCommand = vi.fn(() => ({ status: 1, stdout: "", stderr: "not ready" }));

    controller.abort();
    await expect(
      waitForPostgres("docker", {
        signal: controller.signal,
        runCommand,
        sleep: vi.fn(),
      }),
    ).rejects.toThrow("E2E startup aborted");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("aborts a running migration/build child promptly", async () => {
    const controller = new AbortController();
    const child = runInherit(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], process.env, controller.signal);
    controller.abort();

    await expect(child).resolves.toBe(1);
  });
});

describe("run-start observability", () => {
  it("formats effective workers and the scoped V8 heap cap", () => {
    expect(formatRunStartLog(2, 4096)).toBe(
      "[e2e] Running Playwright (workers=2, node_memory=4096 MB)...",
    );
  });
});

describe("worker CLI validation", () => {
  it.each(["--workers=0", "--workers=-1", "--workers=abc", "--workers"]) (
    "exits non-zero before runtime startup for %s",
    (arg) => {
      const script = fileURLToPath(new URL("../e2e-with-stack.mjs", import.meta.url));
      const result = spawnSync(process.execPath, [script, arg], {
        encoding: "utf8",
        env: { ...process.env, CONTAINER_RUNTIME: "must-not-run" },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Invalid --workers value/);
      expect(result.stderr).not.toMatch(/must-not-run/);
    },
  );
});

/* -------------------------------------------------------------------------- */
/* Phase 3: Lifecycle teardown state machine                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build a lifecycle with fakes that the test can drive deterministically.
 * Returns the lifecycle plus the controllable deps (deferred promises,
 * spies) so tests can fire signal/child-exit/cleanup in any order.
 */
function makeFakes(opts = {}) {
  const restoreClock = useFakeClock();
  const childExit = makeDeferred();
  const child = { pid: 12345, killed: false };
  const waitChildExitDeferred = makeDeferred();
  const waitChildExit = vi.fn(() => Promise.resolve());
  const isChildExited = vi.fn(() => true);
  const killSurvivors = vi.fn(() => {
    child.killed = true;
  });
  const forwardSignal = vi.fn(() => {});
  const webServerCleanupDeferred = makeDeferred();
  const webServerCleanup = vi.fn(() => webServerCleanupDeferred.promise);
  const removePostgresDeferred = makeDeferred();
  const removePostgres = vi.fn(() => removePostgresDeferred.promise);
  const lifecycle = createLifecycle({
    waitChildExit,
    isChildExited,
    killSurvivors,
    forwardSignal,
    webServerCleanup,
    removePostgres,
    forceKillTimeoutMs: opts.forceKillTimeoutMs ?? 5_000,
  });
  return {
    restoreClock,
    lifecycle,
    child,
    childExit,
    waitChildExitDeferred,
    webServerCleanupDeferred,
    removePostgresDeferred,
    waitChildExit,
    isChildExited,
    killSurvivors,
    forwardSignal,
    webServerCleanup,
    removePostgres,
  };
}

/** Flush awaited microtasks until no more pending work. */
async function flush(count = 20) {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

/* ---- Phase 3.1: state machine ---- */
describe("lifecycle state machine", () => {
  it("starts in 'starting' state", () => {
    const { lifecycle, restoreClock } = makeFakes();
    expect(lifecycle.state).toBe("starting");
    restoreClock();
  });

  it("transitions starting → running via markRunning", () => {
    const { lifecycle, restoreClock } = makeFakes();
    lifecycle.markRunning();
    expect(lifecycle.state).toBe("running");
    restoreClock();
  });

  it("stores the child + awaitable child-exit handle immediately on setChild", async () => {
    const { lifecycle, child, childExit, restoreClock } = makeFakes();
    lifecycle.setChild(child, childExit.promise);
    expect(lifecycle.getChild()).toBe(child);
    const spy = vi.fn();
    childExit.promise.then(spy);
    childExit.resolve(0);
    await flush();
    expect(spy).toHaveBeenCalledWith(0);
    restoreClock();
  });

  it("transitions running → exiting → cleaned through teardownOnce", async () => {
    const fakes = makeFakes();
    const { lifecycle, webServerCleanupDeferred, removePostgresDeferred, childExit, waitChildExitDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild({ pid: 1, killed: false }, childExit.promise);
    childExit.resolve(0);
    const teardownP = lifecycle.teardownOnce();
    expect(lifecycle.state).toBe("exiting");
    waitChildExitDeferred.resolve();
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    let exitCode;
    teardownP.then((c) => (exitCode = c));
    await flush(50);
    expect(lifecycle.state).toBe("cleaned");
    expect(exitCode).toBe(0);
    restoreClock();
  });

  it("memoizes teardownOnce — repeated calls return the same promise", () => {
    const { lifecycle, restoreClock } = makeFakes();
    const p1 = lifecycle.teardownOnce();
    const p2 = lifecycle.teardownOnce();
    expect(p1).toBe(p2);
    restoreClock();
  });
});

/* ---- Phase 3.2: signal forwarding + exit precedence ---- */
describe("lifecycle signal handling", () => {
  it("records SIGINT as exit code 130 and resolves signalReceived with the real signal", () => {
    const { lifecycle, restoreClock } = makeFakes();
    lifecycle.recordSignal("SIGINT");
    expect(lifecycle.signalExitCode).toBe(130);
    expect(lifecycle.receivedSignal).toBe("SIGINT");
    restoreClock();
  });

  it("records SIGTERM as exit code 143", () => {
    const { lifecycle, restoreClock } = makeFakes();
    lifecycle.recordSignal("SIGTERM");
    expect(lifecycle.signalExitCode).toBe(143);
    expect(lifecycle.receivedSignal).toBe("SIGTERM");
    restoreClock();
  });

  it("signal code takes precedence over a child-exit normalExitCode", () => {
    const { lifecycle, restoreClock } = makeFakes();
    // Simulate normal completion capturing the child code first.
    lifecycle.setNormalExitCode(0);
    lifecycle.recordSignal("SIGTERM");
    expect(lifecycle.selectPrimaryExitCode()).toBe(143);
    restoreClock();
  });

  it("forwards the real received signal (never undefined) to the child during teardown", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, forwardSignal, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0); // child has exited
    lifecycle.recordSignal("SIGINT");
    const teardownP = lifecycle.teardownOnce();
    await flush();
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    expect(forwardSignal).toHaveBeenCalledWith(child, "SIGINT");
    const calls = forwardSignal.mock.calls.map((c) => c[1]);
    expect(calls.every((sig) => sig !== undefined && sig !== null)).toBe(true);
    let code;
    teardownP.then((c) => (code = c));
    await flush();
    expect(code).toBe(130);
    restoreClock();
  });

  it("does NOT forward a signal when none was received (no undefined)", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, forwardSignal, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    lifecycle.teardownOnce();
    await flush();
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    expect(forwardSignal).not.toHaveBeenCalled();
    restoreClock();
  });

  it("force-kills the child after the bounded wait when it has not exited", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, waitChildExit, waitChildExitDeferred, killSurvivors, webServerCleanupDeferred, removePostgresDeferred, isChildExited, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, makeDeferred().promise);
    lifecycle.recordSignal("SIGINT");
    isChildExited.mockReturnValue(false);
    waitChildExit.mockReturnValue(waitChildExitDeferred.promise);
    lifecycle.teardownOnce();
    await flush();
    // waitChildExit rejects (timeout/forced-kill condition):
    waitChildExitDeferred.reject(new Error("timeout"));
    await flush();
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    expect(killSurvivors).toHaveBeenCalledWith(child);
    restoreClock();
  });

  it("does NOT force-kill if the child already exited", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, waitChildExitDeferred, killSurvivors, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    waitChildExitDeferred.resolve();
    lifecycle.teardownOnce();
    await flush();
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    expect(killSurvivors).not.toHaveBeenCalled();
    restoreClock();
  });

  it("awaits web-server cleanup AND Postgres removal during signal teardown", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, webServerCleanup, removePostgres, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    lifecycle.recordSignal("SIGTERM");
    lifecycle.teardownOnce();
    await flush();
    fakes.webServerCleanupDeferred.resolve();
    await flush();
    fakes.removePostgresDeferred.resolve();
    await flush(50);
    expect(webServerCleanup).toHaveBeenCalledTimes(1);
    expect(removePostgres).toHaveBeenCalledTimes(1);
    restoreClock();
  });
});

/* ---- Phase 3.3: guarded-stage continuation ---- */
describe("lifecycle guarded stages", () => {
  it("records a child-exit-wait error but still runs web-server + PG cleanup and sets cleaned", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, waitChildExit, waitChildExitDeferred, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    waitChildExit.mockReturnValue(waitChildExitDeferred.promise);
    lifecycle.teardownOnce();
    await flush();
    waitChildExitDeferred.reject(new Error("wait blew up"));
    await flush();
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    const stages = lifecycle.cleanupErrors.map((e) => e.stage);
    expect(stages).toContain("child-exit-wait");
    expect(lifecycle.state).toBe("cleaned");
    restoreClock();
  });

  it("records a forced-kill error and still runs cleanup; cleanup never replaces primary code", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, killSurvivors, webServerCleanupDeferred, removePostgresDeferred, isChildExited, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    isChildExited.mockReturnValue(false);
    killSurvivors.mockImplementation(() => {
      throw new Error("kill failed");
    });
    lifecycle.teardownOnce();
    await flush();
    fakes.waitChildExitDeferred.resolve();
    await flush();
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    const stages = lifecycle.cleanupErrors.map((e) => e.stage);
    expect(stages).toContain("timeout-forced-kill");
    expect(lifecycle.state).toBe("cleaned");
    expect(lifecycle.primaryExitCode).toBe(0);
    restoreClock();
  });

  it("web-server cleanup failure still runs Postgres removal", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, webServerCleanup, removePostgres, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    webServerCleanup.mockReturnValue(webServerCleanupDeferred.promise);
    lifecycle.teardownOnce();
    await flush();
    fakes.waitChildExitDeferred.resolve();
    await flush();
    webServerCleanupDeferred.reject(new Error("web cleanup failed"));
    removePostgresDeferred.resolve();
    await flush(50);
    const stages = lifecycle.cleanupErrors.map((e) => e.stage);
    expect(stages).toContain("web-server-cleanup");
    expect(removePostgres).toHaveBeenCalledTimes(1);
    expect(lifecycle.state).toBe("cleaned");
    restoreClock();
  });

  it("PG removal failure still allows 'cleaned' to be set and primary code preserved", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    lifecycle.teardownOnce();
    await flush();
    fakes.waitChildExitDeferred.resolve();
    fakes.webServerCleanupDeferred.resolve();
    await flush();
    removePostgresDeferred.reject(new Error("pg failed"));
    await flush(50);
    const stages = lifecycle.cleanupErrors.map((e) => e.stage);
    expect(stages).toContain("postgres-removal");
    expect(lifecycle.state).toBe("cleaned");
    expect(lifecycle.primaryExitCode).toBe(0);
    restoreClock();
  });
});

/* ---- Phase 3.4: startup failure ---- */
describe("lifecycle startup failure", () => {
  it("preserves the startup failure code as primary, stops partial children, runs cleanup", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, webServerCleanup, removePostgres, waitChildExit, killSurvivors, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.setChild(child, childExit.promise); // partial: web servers started but Playwright not running
    // state is still 'starting' (markRunning NOT called)
    const teardownP = lifecycle.failDuringStartup({ exitCode: 7, message: "migrations failed" });
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    let code;
    teardownP.then((c) => (code = c));
    await flush(50);
    expect(code).toBe(7);
    expect(lifecycle.startupFailureCode).toBe(7);
    expect(lifecycle.primaryExitCode).toBe(7);
    expect(waitChildExit).toHaveBeenCalledWith(child, 5_000);
    expect(webServerCleanup).toHaveBeenCalledTimes(1);
    expect(removePostgres).toHaveBeenCalledTimes(1);
    expect(lifecycle.state).toBe("cleaned");
    restoreClock();
  });

  it("force-kills partial-startup children that did not exit (bounded wait applies)", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, killSurvivors, isChildExited, webServerCleanupDeferred, removePostgresDeferred, waitChildExitDeferred, restoreClock } = fakes;
    isChildExited.mockReturnValue(false);
    lifecycle.setChild(child, makeDeferred().promise);
    fakes.waitChildExit.mockReturnValue(waitChildExitDeferred.promise);
    lifecycle.failDuringStartup({ exitCode: 2 });
    await flush();
    waitChildExitDeferred.reject(new Error("timeout"));
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    expect(killSurvivors).toHaveBeenCalledWith(child);
    expect(lifecycle.primaryExitCode).toBe(2);
    restoreClock();
  });

  it("does NOT use child-exit code for the startup path; startup code wins", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0); // child exits cleanly
    const teardownP = lifecycle.failDuringStartup({ exitCode: 3 });
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    let code;
    teardownP.then((c) => (code = c));
    await flush(50);
    expect(code).toBe(3); // NOT 0 (child code is ignored on startup-failure path)
    restoreClock();
  });
});

/* ---- Phase 3.5: idempotency ---- */
describe("lifecycle idempotency", () => {
  it("concurrent signal + normal + error calls run ONE teardown sequence", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, webServerCleanup, removePostgres, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    const p1 = lifecycle.teardownOnce();        // normal
    lifecycle.recordSignal("SIGINT");            // signal arrives concurrently
    const p2 = lifecycle.teardownOnce();        // signal path joins
    const p3 = lifecycle.teardownOnce();         // finally join
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    expect(webServerCleanup).toHaveBeenCalledTimes(1);
    expect(removePostgres).toHaveBeenCalledTimes(1);
    let code;
    p1.then((c) => (code = c));
    await flush();
    expect(code).toBe(130); // later signal wins
    restoreClock();
  });

  it("later signal recording wins exit-code selection even if normal completion started first", async () => {
    const fakes = makeFakes();
    const { lifecycle, child, childExit, webServerCleanupDeferred, removePostgresDeferred, restoreClock } = fakes;
    lifecycle.markRunning();
    lifecycle.setChild(child, childExit.promise);
    childExit.resolve(0);
    lifecycle.teardownOnce();            // normal completion starts (captures normalExitCode=0)
    await flush();
    lifecycle.recordSignal("SIGTERM");  // late signal — must win
    webServerCleanupDeferred.resolve();
    removePostgresDeferred.resolve();
    await flush(50);
    expect(lifecycle.primaryExitCode).toBe(143);
    restoreClock();
  });
});
