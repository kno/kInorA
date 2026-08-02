/**
 * Object storage boundary port (16a-v3-gym-white-label, Slice 2).
 *
 * A hexagonal boundary interface for storing/serving uploaded branding assets
 * (gym logos). Callers (routes) depend ONLY on this interface — never on a
 * concrete adapter or raw `fs`/network calls — so the storage backend can be
 * swapped (local disk today, S3/R2 later) with zero caller changes.
 *
 * `put` returns a stable, servable `url` for the stored object (never the raw
 * key) so callers never need to know how the adapter maps a key to a URL.
 * `get`/`delete` are keyed by the SAME key the adapter generated internally on
 * `put` (or is otherwise known to the caller, e.g. from a persisted
 * `logoStorageKey`).
 */
export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export interface ObjectStoragePort {
  /**
   * Store `bytes` under `key` with `contentType`. Returns a stable public
   * `url` the caller can persist and later serve to clients.
   */
  put(key: string, bytes: Buffer, contentType: string): Promise<{ url: string }>;

  /**
   * Read back a previously stored object. Returns `null` when `key` does not
   * exist (never throws for a missing key).
   */
  get(key: string): Promise<StoredObject | null>;

  /**
   * Remove a stored object. Idempotent: deleting a missing key is a no-op,
   * never an error.
   */
  delete(key: string): Promise<void>;
}
