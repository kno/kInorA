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
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const composePath = resolve(__dirname, "../../../../../docker-compose.yml");

describe("docker-compose.yml env forwarding", () => {
  it("lists LANGFUSE_PROMPT_CACHE_TTL_MS in the api service's environment: block", () => {
    const compose = readFileSync(composePath, "utf-8");
    expect(compose).toContain("LANGFUSE_PROMPT_CACHE_TTL_MS");
  });
});
