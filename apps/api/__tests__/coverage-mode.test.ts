/**
 * Unit tests for the `apps/api` coverage-mode policy (`coverage-mode.mjs`).
 *
 * The module decides which function-coverage floor a run is entitled to
 * enforce and how the pre-push gate behaves, so its edges are worth pinning:
 * the mode must track the exact condition the integration suites gate on, the
 * CI assertion must fire only for a CI coverage run with no database, an
 * unparseable or unreachable DATABASE_URL must degrade rather than throw, and
 * the failure guidance must never advertise `--no-verify`.
 *
 * `scripts/prepush-coverage.mjs` is the untested remainder on purpose: it is a
 * TCP probe and a `spawn`, and `scripts/__tests__/` is picked up by no vitest
 * project (`pnpm test` is `pnpm -r test` over `apps/*` and `packages/*`). All
 * of its decisions were moved here so they could be tested somewhere that runs.
 *
 * Deliberately outside `src/`: this is build/gate configuration, not product
 * code, and `coverage.include` is `src/**` so nothing here moves the very
 * numbers it governs.
 *
 * Layers used: Unit (no runtime boundary — pure functions over injected env
 * and argv).
 */
import { describe, expect, it, vi } from "vitest";

import {
  HERMETIC_FUNCTIONS_FLOOR,
  INTEGRATED_FUNCTIONS_FLOOR,
  announceLines,
  assertCoverageContext,
  failureGuidance,
  functionsThreshold,
  gateChildEnv,
  isCoverageRun,
  parsePostgresTarget,
  resolveCoverageMode,
  resolveGateDecision,
} from "../coverage-mode.mjs";

const REACHABLE = async () => true;
const UNREACHABLE = async () => false;

describe("resolveCoverageMode", () => {
  it("is hermetic when DATABASE_URL is absent", () => {
    expect(resolveCoverageMode({})).toBe("hermetic");
  });

  it("is hermetic when DATABASE_URL is present but empty", () => {
    // `describe.skipIf(!process.env.DATABASE_URL)` treats "" as absent, so the
    // floor must too — otherwise an empty variable would raise the bar for a
    // run in which every integration suite still skipped.
    expect(resolveCoverageMode({ DATABASE_URL: "" })).toBe("hermetic");
  });

  it("is integrated when DATABASE_URL is set", () => {
    expect(
      resolveCoverageMode({ DATABASE_URL: "postgres://u:p@localhost:5432/db" }),
    ).toBe("integrated");
  });
});

describe("functionsThreshold", () => {
  it("enforces the hermetic floor with no database", () => {
    expect(functionsThreshold({})).toBe(HERMETIC_FUNCTIONS_FLOOR);
  });

  it("enforces the integrated floor with a database", () => {
    expect(
      functionsThreshold({ DATABASE_URL: "postgres://u:p@localhost:5432/db" }),
    ).toBe(INTEGRATED_FUNCTIONS_FLOOR);
  });

  it("keeps the integrated floor strictly above the hermetic one", () => {
    // The two floors exist because the integrated run proves strictly more.
    // If they ever converged, the dual standard would be pure overhead.
    expect(INTEGRATED_FUNCTIONS_FLOOR).toBeGreaterThan(HERMETIC_FUNCTIONS_FLOOR);
  });

  it("leaves churn headroom under both measured figures", () => {
    // Measured on main 78ce941: 91.51% hermetic (local run), 94.35% integrated
    // (CI run 31352490931). A floor set flush against its measurement turns the
    // next honest refactor into a red push.
    expect(HERMETIC_FUNCTIONS_FLOOR).toBeLessThan(91.51);
    expect(INTEGRATED_FUNCTIONS_FLOOR).toBeLessThan(94.35);
  });
});

describe("isCoverageRun", () => {
  it("detects the flag pnpm test:coverage passes", () => {
    expect(isCoverageRun(["node", "vitest", "run", "--coverage"])).toBe(true);
  });

  it("detects dotted coverage options", () => {
    expect(
      isCoverageRun(["node", "vitest", "run", "--coverage.enabled=true"]),
    ).toBe(true);
  });

  it("does not fire for a plain test run", () => {
    expect(isCoverageRun(["node", "vitest", "run"])).toBe(false);
  });
});

describe("assertCoverageContext", () => {
  it("throws when CI measures coverage with no database", () => {
    // The #404 regression: DATABASE_URL dropped from the Coverage step. Without
    // this assertion the run silently falls back to the hermetic floor and
    // passes, reporting coverage the suite never proved.
    expect(() =>
      assertCoverageContext({
        env: { CI: "true" },
        argv: ["node", "vitest", "run", "--coverage"],
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("allows CI to run the hermetic Test step", () => {
    expect(() =>
      assertCoverageContext({
        env: { CI: "true" },
        argv: ["node", "vitest", "run"],
      }),
    ).not.toThrow();
  });

  it("allows CI coverage when the database is wired", () => {
    expect(() =>
      assertCoverageContext({
        env: { CI: "true", DATABASE_URL: "postgres://u:p@localhost:5432/db" },
        argv: ["node", "vitest", "run", "--coverage"],
      }),
    ).not.toThrow();
  });

  it("never blocks a local hermetic coverage run", () => {
    // The supported default for a developer with no Postgres. If this threw,
    // the gate would fail for a reason they cannot act on.
    expect(() =>
      assertCoverageContext({
        env: {},
        argv: ["node", "vitest", "run", "--coverage"],
      }),
    ).not.toThrow();
  });
});

describe("parsePostgresTarget", () => {
  it("extracts host and port", () => {
    expect(parsePostgresTarget("postgres://kinora:kinora@localhost:5433/kinora")).toEqual(
      { host: "localhost", port: 5433 },
    );
  });

  it("accepts the postgresql:// scheme", () => {
    expect(parsePostgresTarget("postgresql://db.internal/kinora")).toEqual({
      host: "db.internal",
      port: 5432,
    });
  });

  it("defaults the port to 5432", () => {
    expect(parsePostgresTarget("postgres://u:p@localhost/kinora")?.port).toBe(5432);
  });

  it("strips the brackets from an IPv6 literal", () => {
    // net.connect wants the bare address; URL.hostname keeps the brackets.
    expect(parsePostgresTarget("postgres://u:p@[::1]:5432/kinora")).toEqual({
      host: "::1",
      port: 5432,
    });
  });

  it("returns null for a non-Postgres URL", () => {
    expect(parsePostgresTarget("https://example.com")).toBeNull();
  });

  it("returns null rather than throwing on an unparseable value", () => {
    // A typo in a developer's shell profile must degrade the pre-push hook to
    // hermetic mode, not crash it.
    expect(parsePostgresTarget("not a url")).toBeNull();
  });

  it("returns null for an out-of-range port", () => {
    expect(parsePostgresTarget("postgres://u:p@localhost:99999/kinora")).toBeNull();
  });

  it("returns null for an absent value", () => {
    expect(parsePostgresTarget(undefined)).toBeNull();
  });
});

describe("resolveGateDecision", () => {
  const DB = "postgres://kinora:kinora@localhost:5433/kinora";

  it("runs hermetic with no DATABASE_URL and never probes", async () => {
    const probe = vi.fn(REACHABLE);
    const decision = await resolveGateDecision({}, probe);

    expect(decision).toEqual({
      mode: "hermetic",
      floor: HERMETIC_FUNCTIONS_FLOOR,
      reason: "DATABASE_URL is not set",
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("runs integrated when the database answers", async () => {
    const probe = vi.fn(REACHABLE);
    const decision = await resolveGateDecision({ DATABASE_URL: DB }, probe);

    expect(decision.mode).toBe("integrated");
    expect(decision.floor).toBe(INTEGRATED_FUNCTIONS_FLOOR);
    expect(decision.reason).toContain("localhost:5433");
    expect(probe).toHaveBeenCalledWith({ host: "localhost", port: 5433 });
  });

  it("degrades to hermetic when DATABASE_URL points at nothing", async () => {
    // The whole point of the design. A developer whose Postgres is stopped gets
    // a lower floor and a working push, not a wall of connection errors from
    // integration suites that decided to run.
    const decision = await resolveGateDecision({ DATABASE_URL: DB }, UNREACHABLE);

    expect(decision.mode).toBe("hermetic");
    expect(decision.floor).toBe(HERMETIC_FUNCTIONS_FLOOR);
    expect(decision.reason).toBe(
      "nothing is accepting connections at localhost:5433",
    );
  });

  it("degrades to hermetic on an unparseable DATABASE_URL rather than throwing", async () => {
    const decision = await resolveGateDecision(
      { DATABASE_URL: "postgres//typo" },
      REACHABLE,
    );

    expect(decision.mode).toBe("hermetic");
    expect(decision.reason).toContain("not a usable Postgres URL");
  });
});

describe("gateChildEnv", () => {
  it("strips DATABASE_URL in hermetic mode so the suites skip cleanly", () => {
    const env = gateChildEnv(
      { PATH: "/bin", DATABASE_URL: "postgres://u:p@localhost:5433/db" },
      "hermetic",
    );

    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env.PATH).toBe("/bin");
  });

  it("keeps DATABASE_URL in integrated mode", () => {
    const env = gateChildEnv(
      { DATABASE_URL: "postgres://u:p@localhost:5433/db" },
      "integrated",
    );

    expect(env.DATABASE_URL).toBe("postgres://u:p@localhost:5433/db");
  });

  it("does not mutate the caller's environment", () => {
    const original = { DATABASE_URL: "postgres://u:p@localhost:5433/db" };
    gateChildEnv(original, "hermetic");

    expect(original.DATABASE_URL).toBe("postgres://u:p@localhost:5433/db");
  });
});

describe("announceLines", () => {
  it("states the mode and the floor before anything runs", () => {
    const text = announceLines({
      mode: "integrated",
      floor: INTEGRATED_FUNCTIONS_FLOOR,
      reason: "Postgres is reachable at localhost:5433",
    }).join("\n");

    expect(text).toContain("integrated mode");
    expect(text).toContain(`>= ${INTEGRATED_FUNCTIONS_FLOOR}%`);
  });

  it("tells a hermetic run which suites are skipping and how to opt in", () => {
    // An implicit dual standard is worse than a single honest one, so the lower
    // floor has to say out loud that it is the lower floor.
    const text = announceLines({
      mode: "hermetic",
      floor: HERMETIC_FUNCTIONS_FLOOR,
      reason: "DATABASE_URL is not set",
    }).join("\n");

    expect(text).toContain("integration suites will SKIP");
    expect(text).toContain("DATABASE_URL");
    expect(text).toContain(`${INTEGRATED_FUNCTIONS_FLOOR}% floor`);
  });
});

describe("failureGuidance", () => {
  it("never advertises --no-verify", () => {
    // The acceptance criterion of #425, and the reason the previous message was
    // a problem: a gate that documents its own bypass trains people to use it.
    for (const mode of ["hermetic", "integrated"] as const) {
      const text = failureGuidance({ mode, floor: 90 }).join("\n");
      expect(text).not.toContain("no-verify");
    }
  });

  it("gives a hermetic run a reproduction that is actually hermetic", () => {
    const text = failureGuidance({
      mode: "hermetic",
      floor: HERMETIC_FUNCTIONS_FLOOR,
    }).join("\n");

    // Plain `pnpm test:coverage` would NOT reproduce it for a developer whose
    // DATABASE_URL is exported but dead — the gate stripped the variable.
    expect(text).toContain("env -u DATABASE_URL pnpm test:coverage");
  });

  it("names the mode and floor that blocked the push", () => {
    const text = failureGuidance({
      mode: "integrated",
      floor: INTEGRATED_FUNCTIONS_FLOOR,
    }).join("\n");

    expect(text).toContain("integrated mode");
    expect(text).toContain(`floor ${INTEGRATED_FUNCTIONS_FLOOR}%`);
  });
});
