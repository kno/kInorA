import { describe, it, expect, vi } from "vitest";
import { SessionRepository } from "../session.js";

// These tests follow the project's existing mock-db chain pattern
// (see apps/api/src/tenant/__tests__/repositories.test.ts) to exercise
// repository query construction against a controllable in-memory stand-in,
// without a live database or a new test-only dependency.

function buildSession(): {
  tokenHash: string;
  userId: string;
  tenantId: string;
  createdAt: Date;
  expiresAt: Date;
} {
  return {
    tokenHash: "a".repeat(64),
    userId: "01912f70-2c5b-7e2e-b8e5-3e7c6a4d2f1a",
    tenantId: "01912f70-2c5b-7e2e-b8e5-3e7c6a4d2f1b",
    createdAt: new Date("2026-06-22T12:00:00Z"),
    expiresAt: new Date("2026-06-23T12:00:00Z"),
  };
}

describe("SessionRepository", () => {
  describe("findByTokenHash", () => {
    it("returns the session row when a matching tokenHash exists", async () => {
      const session = buildSession();
      const where = vi.fn().mockResolvedValue([session]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const repo = new SessionRepository({ select } as never);
      const result = await repo.findByTokenHash(session.tokenHash);

      expect(select).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(result).toEqual(session);
    });

    it("returns null when no session matches the tokenHash", async () => {
      const where = vi.fn().mockResolvedValue([]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const repo = new SessionRepository({ select } as never);
      const result = await repo.findByTokenHash("b".repeat(64));

      expect(result).toBeNull();
    });

    // Triangulation: a different tokenHash queries its own session
    it("returns a different session for a different tokenHash", async () => {
      const other = { ...buildSession(), tokenHash: "c".repeat(64) };
      const where = vi.fn().mockResolvedValue([other]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const repo = new SessionRepository({ select } as never);
      const result = await repo.findByTokenHash(other.tokenHash);

      expect(result).toEqual(other);
      expect(result?.tokenHash).toBe("c".repeat(64));
    });
  });

  describe("create", () => {
    it("inserts a session row and returns it", async () => {
      const session = buildSession();
      const returning = vi.fn().mockResolvedValue([session]);
      const values = vi.fn().mockReturnValue({ returning });
      const insert = vi.fn().mockReturnValue({ values });

      const repo = new SessionRepository({ insert } as never);
      const result = await repo.create({
        tokenHash: session.tokenHash,
        userId: session.userId,
        tenantId: session.tenantId,
        expiresAt: session.expiresAt,
      });

      expect(insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(session);
    });
  });

  describe("delete", () => {
    it("deletes the session identified by tokenHash", async () => {
      const where = vi.fn().mockResolvedValue(undefined);
      const del = vi.fn().mockReturnValue({ where });

      const repo = new SessionRepository({ delete: del } as never);
      await repo.delete("a".repeat(64));

      expect(del).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleteByUserId", () => {
    it("deletes all sessions for a user", async () => {
      const where = vi.fn().mockResolvedValue(undefined);
      const del = vi.fn().mockReturnValue({ where });

      const repo = new SessionRepository({ delete: del } as never);
      await repo.deleteByUserId("01912f70-2c5b-7e2e-b8e5-3e7c6a4d2f1a");

      expect(del).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
    });
  });
});