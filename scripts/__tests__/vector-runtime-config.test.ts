import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PG_IMAGE } from "../e2e-with-stack.mjs";

const repoRoot = resolve(import.meta.dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("pgvector runtime configuration", () => {
  it("keeps every checked-in Postgres runtime on the same pgvector image", () => {
    expect(PG_IMAGE).toBe("pgvector/pgvector:pg17");

    expect(readRepoFile("docker-compose.yml")).toContain(
      "image: pgvector/pgvector:pg17",
    );
    expect(readRepoFile(".github/workflows/ci-cd.yml")).toContain(
      "pgvector/pgvector:pg17",
    );
  });

  it("documents the pgvector migration prerequisite before developers run db:migrate", () => {
    expect(readRepoFile("README.md")).toContain("pgvector/pgvector:pg17");
    expect(readRepoFile("README.md")).toContain("CREATE EXTENSION vector");

    expect(readRepoFile("apps/api/README.md")).toContain("pgvector/pgvector:pg17");
    expect(readRepoFile("apps/api/README.md")).toContain("pnpm --filter api db:migrate");

    expect(readRepoFile(".env.example")).toContain("pgvector/pgvector:pg17");
  });
});
