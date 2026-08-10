// @ts-check
/**
 * Which function-coverage floor the `apps/api` suite is entitled to enforce,
 * and how to locate the database that decides it.
 *
 * Every `*.integration.test.ts` in this package is gated behind
 * `describe.skipIf(!process.env.DATABASE_URL)`. The presence of that ONE
 * variable therefore changes which code the coverage run actually executes,
 * and by a lot:
 *
 *   94.35%  integrated — DATABASE_URL present, all 20 integration suites run
 *           their real bodies (measured on main 78ce941, CI run 31352490931).
 *   91.51%  hermetic — no DATABASE_URL, every integration suite skips
 *           (measured locally on the same commit, 2360 passed / 152 skipped).
 *
 * A single floor has to be derived from the LOWER number or it blocks every
 * developer without a local Postgres — and the pre-push hook's remedy for a
 * blocked push used to be `git push --no-verify`, which is the habit this gate
 * exists to prevent. So instead of one dishonest floor there are two honest
 * ones, and this module is the single place that states them. Both the vitest
 * config that enforces a floor and `scripts/prepush-coverage.mjs` that
 * announces one read them from here, so the number a developer is told cannot
 * drift from the number they are held to.
 *
 * The pre-push gate's policy — which mode a push runs in, what it announces,
 * what it says when it fails — lives here too rather than in
 * `scripts/prepush-coverage.mjs`, for one blunt reason: `scripts/__tests__/`
 * is picked up by NO vitest project (`pnpm test` is `pnpm -r test`, which
 * covers `apps/*` and `packages/*` only, and every package's `include`
 * resolves against its own root). Tests written next to that script would
 * never run. Everything here is exercised by `__tests__/coverage-mode.test.ts`
 * inside a project that actually runs; the script keeps only the I/O it cannot
 * be tested without — the TCP probe and the child process.
 *
 * Plain ESM with JSDoc types, same as `scripts/e2e-with-stack.mjs`: it is
 * imported both by `vitest.config.ts` (which Vite processes) and by a bare
 * `node` script that has no TypeScript loader. `apps/api/tsconfig.json`
 * includes only `src`, so this file is outside `tsc` by construction.
 */

/**
 * Hermetic floor: no database, integration suites skipped.
 *
 * Bounded above by the measured 91.51%, with ~1.5 points of churn headroom.
 * Unchanged from the single floor that #417 set — this is still exactly what
 * the suite proves with no infrastructure at all.
 */
export const HERMETIC_FUNCTIONS_FLOOR = 90;

/**
 * Integrated floor: DATABASE_URL present, integration suites executing.
 *
 * Bounded above by the measured 94.35%, with 1.35 points of churn headroom —
 * the same margin discipline as the hermetic floor, not "whatever the last run
 * happened to report". Raising this to 94 would leave 0.35 points, which one
 * refactor of a repository class can spend.
 */
export const INTEGRATED_FUNCTIONS_FLOOR = 93;

/**
 * @typedef {"hermetic" | "integrated"} CoverageMode
 */

/**
 * Resolve the coverage mode from the environment.
 *
 * Deliberately keyed on the PRESENCE of `DATABASE_URL` and nothing else,
 * because that is the exact condition `describe.skipIf(!process.env.DATABASE_URL)`
 * tests. Any cleverer predicate here would let the floor and the suite
 * selection disagree, which is the whole failure this module exists to close.
 *
 * A `DATABASE_URL` that is set but unreachable is NOT a false green: the
 * integration suites run, fail to connect and red the run. Reachability is the
 * pre-push hook's problem (see `scripts/prepush-coverage.mjs`), not this
 * function's.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {CoverageMode}
 */
export function resolveCoverageMode(env = process.env) {
  return env.DATABASE_URL ? "integrated" : "hermetic";
}

/**
 * The function-coverage floor that applies to the current environment.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function functionsThreshold(env = process.env) {
  return resolveCoverageMode(env) === "integrated"
    ? INTEGRATED_FUNCTIONS_FLOOR
    : HERMETIC_FUNCTIONS_FLOOR;
}

/**
 * Whether the current vitest invocation is measuring coverage.
 *
 * `vitest.config.ts` is loaded by BOTH `pnpm test` and `pnpm test:coverage`,
 * and CI's `Test` step deliberately runs the former with no database. Only the
 * coverage run is subject to `assertCoverageContext`, so the check has to be
 * able to tell them apart, and argv is the only signal available at config
 * load time.
 *
 * @param {string[]} [argv]
 * @returns {boolean}
 */
export function isCoverageRun(argv = process.argv) {
  return argv.some((arg) => arg === "--coverage" || arg.startsWith("--coverage."));
}

/**
 * Fail loudly when CI measures `apps/api` coverage without a database.
 *
 * This is the one regression the two-floor design cannot catch by itself. If
 * `DATABASE_URL` were dropped from the workflow's `Coverage` step (exactly the
 * #404 regression) the run would silently fall back to the hermetic mode and
 * PASS at the lower floor, reporting three points of coverage the suite never
 * proved. A number cannot detect that; an assertion can.
 *
 * Scoped to CI on purpose: locally, a hermetic coverage run is the supported
 * default and must never throw.
 *
 * @param {{ env?: Record<string, string | undefined>, argv?: string[] }} [input]
 * @returns {void}
 */
export function assertCoverageContext(input = {}) {
  const env = input.env ?? process.env;
  const argv = input.argv ?? process.argv;
  if (!env.CI) return;
  if (!isCoverageRun(argv)) return;
  if (env.DATABASE_URL) return;
  throw new Error(
    "apps/api coverage was invoked in CI without DATABASE_URL. Every " +
      "*.integration.test.ts is gated behind " +
      "describe.skipIf(!process.env.DATABASE_URL), so this run would measure " +
      "the hermetic suite and report it as if the integration suites had " +
      "passed. Restore DATABASE_URL on the workflow's Coverage step (#404, " +
      "#425).",
  );
}

/**
 * Extract the TCP endpoint from a Postgres connection URL.
 *
 * Used only to decide whether a database is worth pointing the coverage run
 * at. Returns `null` for anything that is not a Postgres URL rather than
 * throwing, because an unparseable `DATABASE_URL` must degrade the pre-push
 * hook to hermetic mode, never crash it.
 *
 * @param {string | undefined} url
 * @returns {{ host: string, port: number } | null}
 */
export function parsePostgresTarget(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return null;
  }
  // `URL.hostname` keeps the brackets on an IPv6 literal; `net.connect` wants
  // the bare address.
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
  const host = hostname === "" ? "localhost" : hostname;
  const port = parsed.port === "" ? 5432 : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/**
 * @typedef {{ mode: CoverageMode, floor: number, reason: string }} GateDecision
 */

/**
 * Decide which mode the pre-push coverage gate runs in.
 *
 * Three branches, and the middle one is the point of the whole design: a
 * `DATABASE_URL` that is set but that nothing answers on degrades to hermetic
 * instead of handing the developer a wall of connection errors. Starting
 * Postgres is how you opt INTO the stricter floor; it is never what stands
 * between you and a push.
 *
 * @param {Record<string, string | undefined>} env
 * @param {(target: { host: string, port: number }) => Promise<boolean>} probe
 * @returns {Promise<GateDecision>}
 */
export async function resolveGateDecision(env, probe) {
  const target = parsePostgresTarget(env.DATABASE_URL);
  if (target === null) {
    return {
      mode: "hermetic",
      floor: HERMETIC_FUNCTIONS_FLOOR,
      reason: env.DATABASE_URL
        ? "DATABASE_URL is set but is not a usable Postgres URL"
        : "DATABASE_URL is not set",
    };
  }
  if (!(await probe(target))) {
    return {
      mode: "hermetic",
      floor: HERMETIC_FUNCTIONS_FLOOR,
      reason: `nothing is accepting connections at ${target.host}:${target.port}`,
    };
  }
  return {
    mode: "integrated",
    floor: INTEGRATED_FUNCTIONS_FLOOR,
    reason: `Postgres is reachable at ${target.host}:${target.port}`,
  };
}

/**
 * The environment handed to the coverage child process.
 *
 * In hermetic mode `DATABASE_URL` is REMOVED rather than left in place, so the
 * integration suites skip cleanly instead of running and failing to connect.
 * Leaving a dead value in would reintroduce exactly the unactionable failure
 * this gate is meant to avoid.
 *
 * @param {Record<string, string | undefined>} env
 * @param {CoverageMode} mode
 * @returns {Record<string, string | undefined>}
 */
export function gateChildEnv(env, mode) {
  const next = { ...env };
  if (mode === "hermetic") delete next.DATABASE_URL;
  return next;
}

/**
 * What the gate prints BEFORE running, so a developer knows which standard
 * they are being held to ahead of a failure rather than after one. An implicit
 * dual floor would be worse than a single dishonest one.
 *
 * @param {GateDecision} decision
 * @returns {string[]}
 */
export function announceLines(decision) {
  const lines = [
    `=== Pre-push: coverage gate (${decision.mode} mode) ===`,
    `    ${decision.reason}.`,
    `    apps/api function coverage must be >= ${decision.floor}%.`,
  ];
  if (decision.mode === "hermetic") {
    lines.push(
      `    The apps/api integration suites will SKIP. Start a Postgres and`,
      `    export DATABASE_URL to run them and be held to the ${INTEGRATED_FUNCTIONS_FLOOR}% floor`,
      `    that CI enforces.`,
    );
  }
  return lines;
}

/**
 * What the gate prints when the coverage run fails.
 *
 * Never names `--no-verify`. A gate whose documented remedy is to bypass the
 * gate teaches people to bypass gates — the failure mode #423 already produced
 * once, where flaky red became noise.
 *
 * @param {GateDecision} decision
 * @returns {string[]}
 */
export function failureGuidance(decision) {
  return [
    ``,
    `Coverage gate failed (${decision.mode} mode, apps/api floor ${decision.floor}%). Push blocked.`,
    `Reproduce exactly what just ran with:`,
    decision.mode === "hermetic"
      ? `    env -u DATABASE_URL pnpm test:coverage`
      : `    pnpm test:coverage`,
    `Then close the gap with a test that exercises the uncovered path.`,
    `Thresholds live in vitest.shared.ts and each package's vitest.config.ts;`,
    `the apps/api floors are in apps/api/coverage-mode.mjs.`,
  ];
}
