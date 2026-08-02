import { promises as fs } from "node:fs";
import path from "node:path";
import type { ObjectStoragePort, StoredObject } from "./object-storage-port.js";

/**
 * Disk-backed `ObjectStoragePort` implementation (16a-v3-gym-white-label,
 * Slice 2). Infra-layer only — routes never import this class directly, they
 * depend on the `ObjectStoragePort` boundary interface (constructed once in
 * `app.ts`, the composition root).
 *
 * Base directory: `STORAGE_LOCAL_DIR` env var, or (in production/dev, when
 * unset) a documented default local path under the process cwd. Prod MUST
 * mount `STORAGE_LOCAL_DIR` under the VPS deploy volume
 * (`/mnt/blockvolume/homes/kinora/deploy/...`) OUTSIDE the container image so
 * uploads survive redeploys (tracked as an open ops question in design.md).
 *
 * Each stored object is two files on disk: `<baseDir>/<key>` (the raw bytes)
 * and `<baseDir>/<key>.meta.json` (a small `{ contentType }` sidecar) — local
 * disk has no first-class notion of a stored content-type, so the adapter
 * persists it itself and reads it back on `get`.
 *
 * Path-traversal safety: `key` is the ONLY caller-controlled input. It is
 * validated against a strict allowlist (`^[A-Za-z0-9_-]+$`) BEFORE any
 * filesystem call — this rejects both traversal segments (`..`, `/`, `\`) and
 * any other unexpected character, so a malicious/buggy key can never resolve
 * outside `baseDir`. The route layer additionally always generates keys
 * itself (server-generated UUIDs, see `routes/branding.ts`), so this is
 * defence-in-depth, not the only guard.
 */
const SAFE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Default local storage root when `STORAGE_LOCAL_DIR` is unset. */
export const DEFAULT_STORAGE_LOCAL_DIR = path.join(process.cwd(), ".storage", "branding");

export function resolveStorageLocalDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.STORAGE_LOCAL_DIR;
  return configured && configured.trim() !== "" ? configured.trim() : DEFAULT_STORAGE_LOCAL_DIR;
}

interface StoredMeta {
  contentType: string;
}

export class LocalStorageAdapter implements ObjectStoragePort {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(baseDir ?? resolveStorageLocalDir());
  }

  /**
   * Validate `key` and resolve its on-disk path, guaranteed to stay within
   * `baseDir`. Throws for any key that fails the allowlist or would resolve
   * outside the base directory.
   */
  private resolveObjectPath(key: string): string {
    if (!SAFE_KEY_PATTERN.test(key)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    const resolved = path.resolve(this.baseDir, key);
    // Defence-in-depth: even though the allowlist already rejects traversal
    // segments, verify the resolved path is still inside baseDir before any
    // filesystem call.
    const relative = path.relative(this.baseDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return resolved;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<{ url: string }> {
    const objectPath = this.resolveObjectPath(key);
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(objectPath, bytes);
    const meta: StoredMeta = { contentType };
    await fs.writeFile(`${objectPath}.meta.json`, JSON.stringify(meta));
    return { url: `/media/branding/${key}` };
  }

  async get(key: string): Promise<StoredObject | null> {
    let objectPath: string;
    try {
      objectPath = this.resolveObjectPath(key);
    } catch {
      return null;
    }
    try {
      const bytes = await fs.readFile(objectPath);
      const metaRaw = await fs.readFile(`${objectPath}.meta.json`, "utf-8");
      const meta = JSON.parse(metaRaw) as StoredMeta;
      return { bytes, contentType: meta.contentType };
    } catch (error) {
      if (isEnoent(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    let objectPath: string;
    try {
      objectPath = this.resolveObjectPath(key);
    } catch {
      // An invalid key can never have been stored — deleting it is a no-op,
      // consistent with the port's idempotent-delete contract.
      return;
    }
    await fs.rm(objectPath, { force: true });
    await fs.rm(`${objectPath}.meta.json`, { force: true });
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
