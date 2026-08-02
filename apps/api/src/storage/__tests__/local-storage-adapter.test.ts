import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalStorageAdapter } from "../local-storage-adapter.js";

/**
 * LocalStorageAdapter unit tests (16a-v3-gym-white-label, Slice 2, tasks
 * 2.1-2.3). Each test builds a fresh adapter rooted at a real temp dir (never
 * mocks `fs`) so the round-trip and path-traversal guarantees are exercised
 * against the real filesystem.
 */
describe("LocalStorageAdapter", () => {
  let tempDir: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kinora-storage-test-"));
    adapter = new LocalStorageAdapter(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("put", () => {
    it("writes bytes to the base dir under the given key and returns a stable url (task 2.1)", async () => {
      const bytes = Buffer.from("hello world");
      const result = await adapter.put("abc-123", bytes, "image/png");

      expect(result.url).toBe("/media/branding/abc-123");

      // The bytes are actually persisted on disk under the base dir.
      const stored = await fs.readFile(path.join(tempDir, "abc-123"));
      expect(stored.equals(bytes)).toBe(true);
    });

    it("never escapes the base dir for a key containing path traversal segments (task 2.1)", async () => {
      const bytes = Buffer.from("malicious");

      await expect(
        adapter.put("../../etc/passwd", bytes, "image/png"),
      ).rejects.toThrow();

      // Nothing was written outside the temp dir.
      const outsidePath = path.join(path.dirname(tempDir), "etc", "passwd");
      await expect(fs.access(outsidePath)).rejects.toThrow();
    });

    it("rejects a key containing a path separator (task 2.1)", async () => {
      await expect(
        adapter.put("nested/key", Buffer.from("x"), "image/png"),
      ).rejects.toThrow();
    });
  });

  describe("get", () => {
    it("returns bytes + contentType for an existing key (task 2.2)", async () => {
      const bytes = Buffer.from("logo-bytes");
      await adapter.put("logo-1", bytes, "image/webp");

      const result = await adapter.get("logo-1");

      expect(result).not.toBeNull();
      expect(result?.bytes.equals(bytes)).toBe(true);
      expect(result?.contentType).toBe("image/webp");
    });

    it("returns null for an unknown key (task 2.2)", async () => {
      const result = await adapter.get("does-not-exist");
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("removes a stored key so a subsequent get returns null (task 2.3)", async () => {
      await adapter.put("to-delete", Buffer.from("bye"), "image/png");
      await adapter.delete("to-delete");

      const result = await adapter.get("to-delete");
      expect(result).toBeNull();
    });

    it("is idempotent for a missing key (task 2.3)", async () => {
      await expect(adapter.delete("never-existed")).resolves.toBeUndefined();
    });
  });
});
