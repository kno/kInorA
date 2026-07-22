import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("vector memory rollout and rollback notes", () => {
  it("documents how embedding runtime settings align with the pgvector runtime", () => {
    expect(readRepoFile("README.md")).toContain("VECTOR_MEMORY_EMBEDDING_MODEL");
    expect(readRepoFile("README.md")).toContain("VECTOR_MEMORY_EMBEDDING_DIMENSION");
    expect(readRepoFile("apps/api/README.md")).toContain("VECTOR_MEMORY_EMBEDDING_MODEL");
    expect(readRepoFile("apps/api/README.md")).toContain("VECTOR_MEMORY_EMBEDDING_DIMENSION");
  });

  it("documents the current rollback boundary in compose and developer docs", () => {
    expect(readRepoFile("docker-compose.yml")).toContain("embedding/runtime configuration must stay aligned");
    expect(readRepoFile("docker-compose.yml")).toContain("Unset OPENAI_API_KEY to fail open");
    expect(readRepoFile("README.md")).toContain("rollback boundary");
    expect(readRepoFile("apps/api/README.md")).toContain("rollback boundary");
  });
});
