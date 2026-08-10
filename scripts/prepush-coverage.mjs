#!/usr/bin/env node
// @ts-check
/**
 * Pre-push coverage gate (#425).
 *
 * `.githooks/pre-push` used to run `pnpm test:coverage` blind. That measures a
 * different thing from CI: every `apps/api` `*.integration.test.ts` is gated
 * behind `describe.skipIf(!process.env.DATABASE_URL)`, so a hermetic run skips
 * all of them and reports ~3 points less function coverage than the same commit
 * does in CI. The single floor therefore had to be derived from the lower
 * number, which left the three points CI genuinely proves unenforced.
 *
 * This makes the gate mode-aware instead of raising a floor nobody can meet
 * locally:
 *
 *   integrated — DATABASE_URL is set AND its host:port accepts a TCP
 *                connection. The integration suites run; apps/api is held to
 *                the integrated floor. This is what CI does.
 *   hermetic   — no DATABASE_URL, or one that nothing is listening on. Those
 *                suites skip; apps/api is held to the lower floor a run with no
 *                infrastructure can honestly prove.
 *
 * The governing rule is that the hook must never fail for a reason a developer
 * cannot act on locally, which is why an unreachable DATABASE_URL degrades
 * (out loud) rather than erroring.
 *
 * Every decision here — modes, floors, the announcement and the failure
 * guidance — lives in apps/api/coverage-mode.mjs, which is also what
 * vitest.config.ts enforces from and what has real unit tests. This file is
 * deliberately the untestable remainder: a TCP probe and a child process.
 */

import { spawn } from "node:child_process";
import net from "node:net";

import {
  announceLines,
  failureGuidance,
  gateChildEnv,
  resolveGateDecision,
} from "../apps/api/coverage-mode.mjs";

/**
 * How long to wait for a TCP handshake before calling the database absent.
 * Generous for a container on loopback, short enough that a stale DATABASE_URL
 * costs a developer two seconds rather than a connection timeout.
 */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Probe a TCP endpoint. Resolves true only on a completed connection.
 *
 * Deliberately TCP-level rather than a real Postgres handshake: this decides
 * which SUITES to run, and "something is listening" is the honest predicate for
 * that. A listener that then rejects the credentials still reds the run, which
 * is correct — that is a real, actionable local misconfiguration.
 *
 * @param {{ host: string, port: number }} target
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
function probeTcp(target, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: target.host, port: target.port });
    let settled = false;
    const finish = (/** @type {boolean} */ reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/**
 * Run the coverage command and resolve with its exit code.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<number>}
 */
function runCoverage(env) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["test:coverage"], { stdio: "inherit", env });
    child.on("error", (error) => {
      console.error(`Failed to run 'pnpm test:coverage': ${error.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const decision = await resolveGateDecision(process.env, probeTcp);
  for (const line of announceLines(decision)) console.log(line);

  const status = await runCoverage(gateChildEnv(process.env, decision.mode));
  if (status !== 0) {
    for (const line of failureGuidance(decision)) console.error(line);
    return 1;
  }
  console.log(`Coverage thresholds met (${decision.mode} mode). Push allowed.`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
