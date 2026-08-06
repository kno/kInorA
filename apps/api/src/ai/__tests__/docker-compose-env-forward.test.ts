import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * PR #254 gotcha: `docker-compose.yml`'s `environment:` block only forwards
 * vars explicitly listed there. A var read in code but absent from
 * `environment:` is silently unset in the deployed container while still
 * appearing to work under local `pnpm dev` (which reads the process
 * environment directly) — this exact omission previously killed billing in
 * production. This test guards the langfuse-prompt-management cache TTL var
 * the same way (B2.13).
 *
 * The failure mode is about PLACEMENT, so a whole-file `toContain` would not
 * catch it: the var appearing in a comment, in another service, or under
 * `volumes:` would reproduce the very bug this guards against while the
 * assertion stayed green. The block is therefore located and scanned.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const composePath = resolve(__dirname, "../../../../../docker-compose.yml");

/**
 * Returns the `environment:` entries of one top-level compose service, keyed by
 * var name. Services are 2-space-indented keys under `services:`; a service's
 * body ends at the next key at that same indent.
 */
function environmentOf(compose: string, service: string): Record<string, string> {
  const lines = compose.split("\n");
  const serviceStart = lines.findIndex((line) => line === `  ${service}:`);
  if (serviceStart === -1) throw new Error(`service "${service}" not found in docker-compose.yml`);

  const afterService = lines.slice(serviceStart + 1);
  const serviceEnd = afterService.findIndex((line) => /^ {2}\S/.test(line));
  const body = serviceEnd === -1 ? afterService : afterService.slice(0, serviceEnd);

  const envStart = body.findIndex((line) => line === "    environment:");
  if (envStart === -1) throw new Error(`service "${service}" has no environment: block`);

  const afterEnv = body.slice(envStart + 1);
  const envEnd = afterEnv.findIndex((line) => /^ {4}\S/.test(line));
  const envLines = envEnd === -1 ? afterEnv : afterEnv.slice(0, envEnd);

  const entries: Record<string, string> = {};
  for (const line of envLines) {
    const match = /^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (match) entries[match[1]!] = match[2]!.trim();
  }
  return entries;
}

describe("docker-compose.yml env forwarding", () => {
  const compose = readFileSync(composePath, "utf-8");

  it("lists LANGFUSE_PROMPT_CACHE_TTL_MS in the api service's environment: block", () => {
    const env = environmentOf(compose, "api");
    expect(Object.keys(env)).toContain("LANGFUSE_PROMPT_CACHE_TTL_MS");
  });

  it("forwards it with a default so no VPS .env edit is required to deploy", () => {
    const env = environmentOf(compose, "api");
    // `${VAR:-default}` keeps the container working when the host does not set
    // the var; a bare `${VAR}` would forward an empty string instead.
    expect(env["LANGFUSE_PROMPT_CACHE_TTL_MS"]).toMatch(/^\$\{LANGFUSE_PROMPT_CACHE_TTL_MS:-\d+\}$/);
  });

  it("still forwards the Langfuse credentials the tracing handler reads", () => {
    const env = environmentOf(compose, "api");
    // A1/A2 depend on these; a refactor of this block must not drop them.
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_HOST"]),
    );
  });
});
