/**
 * Shared auth/session/membership test mocks.
 *
 * The auth pipeline issues two ordered `db.select()` queries per authenticated
 * request:
 *   1. SessionRepository.findByTokenHash        → session row
 *   2. MembershipRepository.findByTenantAndUser → tenant-scoped membership row
 *      (fail-secure re-check that the user is still `active` for the session's
 *      tenant).
 *
 * These helpers centralise the session/membership row builders and the mock DB
 * shapes so every suite (`plugin.test.ts`, `ws.test.ts`, `plan.test.ts`,
 * `plan-generation.test.ts`, `admin-ai-config.test.ts`, repo tests) shares ONE
 * definition of that ordering. Test infrastructure only — excluded from
 * coverage in `apps/api/vitest.config.ts`.
 */
import { vi } from "vitest";
import type { Database } from "../db/client.js";

// --- Shared constants ---------------------------------------------------

/** A well-formed opaque bearer token (64 hex-ish chars) used across suites. */
export const VALID_TOKEN = "a".repeat(64);
/** Mock token hash stored on the session row. */
export const SESSION_HASH = "b".repeat(64);

export const DEFAULT_TENANT_ID = "tenant-uuid-1";
export const DEFAULT_USER_ID = "user-uuid-1";

export type MembershipStatus = "invited" | "active" | "suspended";

// --- Row builders -------------------------------------------------------

export interface SessionRowOptions {
  tokenHash?: string;
  tenantId?: string;
  userId?: string;
  /** Milliseconds from now until expiry. Positive = valid, negative = expired. */
  expiresInMs?: number;
}

/** Build a session row as returned by SessionRepository.findByTokenHash. */
export function buildSessionRow(opts: SessionRowOptions = {}) {
  const expiresInMs = opts.expiresInMs ?? 3_600_000;
  return {
    tokenHash: opts.tokenHash ?? SESSION_HASH,
    userId: opts.userId ?? DEFAULT_USER_ID,
    tenantId: opts.tenantId ?? DEFAULT_TENANT_ID,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + expiresInMs),
  };
}

export interface MembershipRowOptions {
  tenantId?: string;
  userId?: string;
  status?: MembershipStatus;
  role?: "owner" | "member";
  id?: string;
}

/**
 * Build a membership row as returned by MembershipRepository.findByTenantAndUser.
 * Kept DISTINCT from the session row so the membership query is represented as
 * its own result, never blended into the session row.
 */
export function buildMembershipRow(opts: MembershipRowOptions = {}) {
  return {
    id: opts.id ?? "membership-uuid-1",
    tenantId: opts.tenantId ?? DEFAULT_TENANT_ID,
    userId: opts.userId ?? DEFAULT_USER_ID,
    role: opts.role ?? "member",
    status: opts.status ?? "active",
    createdAt: new Date(),
  } as {
    id: string;
    tenantId: string;
    userId: string;
    role: "owner" | "member";
    status: MembershipStatus;
    createdAt: Date;
  };
}

export const buildActiveMembershipRow = (opts: MembershipRowOptions = {}) =>
  buildMembershipRow({ ...opts, status: "active" });

export const buildSuspendedMembershipRow = (opts: MembershipRowOptions = {}) =>
  buildMembershipRow({ ...opts, status: "suspended" });

export const buildInvitedMembershipRow = (opts: MembershipRowOptions = {}) =>
  buildMembershipRow({ ...opts, status: "invited" });

// --- Low-level drizzle select chain ------------------------------------

/** A single `select().from().where()` chain resolving to fixed rows. */
export function selectChain(rows: unknown[] = []) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

// --- Ordered mock DB ----------------------------------------------------

/** A mock Database whose ordered per-select results are recorded for assertions. */
export interface AuthMockDb {
  db: Database;
  select: ReturnType<typeof vi.fn>;
  /** Rows resolved by each `select().from().where()` call, in call order. */
  resolvedByCall: unknown[][];
}

/**
 * Build a mock DB that resolves an ordered sequence of select results.
 *
 * The first two entries model the auth pipeline (session, then tenant-scoped
 * membership); any `additionalRows` follow for route-level selects. Callers can
 * omit `membershipRows` to get a default active membership, pass a suspended /
 * invited row, or pass `[]` to model "no membership for this tenant".
 *
 * `resolvedByCall` records the rows each call resolved so a test can assert the
 * ordinal position of the membership re-check when a repository-level spy is not
 * available (raw query-ordering coverage).
 */
export function createAuthMockDb(opts: {
  sessionRows?: unknown[];
  membershipRows?: unknown[];
  additionalRows?: unknown[][];
} = {}): AuthMockDb {
  const sessionRows = opts.sessionRows ?? [buildSessionRow()];
  const membershipRows = opts.membershipRows ?? [buildActiveMembershipRow()];
  const allRows = [sessionRows, membershipRows, ...(opts.additionalRows ?? [])];

  let callCount = 0;
  const resolvedByCall: unknown[][] = [];

  const select = vi.fn().mockImplementation(() => {
    const rows = (allRows[callCount] ?? []) as unknown[];
    callCount++;
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(async () => {
          resolvedByCall.push(rows);
          return rows;
        }),
      }),
    };
  });

  return { db: { select } as unknown as Database, select, resolvedByCall };
}

/** Ordinal position of the membership re-check select: session=0, membership=1. */
export const MEMBERSHIP_SELECT_INDEX = 1;

// --- Cycling mock DB (for multi-request WS suites) ---------------------

/**
 * Build a mock DB that repeats the (session, membership) select pair for EACH
 * authenticated request. Every WS request performs exactly two ordered selects
 * (session then tenant-scoped membership) via either the Bearer onRequest hook
 * or the ?token= preValidation path (never interleaved), so results cycle
 * pairwise: even-indexed call → session, odd-indexed → membership.
 *
 * Session and membership presence are independent, so a valid session with a
 * missing membership ("no membership for this tenant") is representable.
 */
export function createCyclingAuthMockDb(opts: {
  sessionRows?: unknown[];
  membershipRows?: unknown[];
} = {}): Database {
  const sessionRows = opts.sessionRows ?? [];
  const membershipRows = opts.membershipRows ?? [];
  let call = 0;
  const select = vi.fn().mockImplementation(() => {
    const isSessionCall = call % 2 === 0;
    call++;
    const rows = isSessionCall ? sessionRows : membershipRows;
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    };
  });
  return { select } as unknown as Database;
}

// --- Tenant-aware mock DB ----------------------------------------------

/**
 * Build a mock DB whose membership select resolves the row for the SESSION's
 * tenant, faithfully modelling the tenant-scoped `findByTenantAndUser` lookup.
 * This makes the multi-tenant scenario representable: a user active in one
 * tenant and suspended in another gets the status of the tenant their session
 * is scoped to — not a nondeterministic by-user row.
 */
export function createTenantAwareAuthMockDb(opts: {
  sessionRows: Array<{ tenantId: string; userId: string; [k: string]: unknown }>;
  membershipsByTenant: Record<
    string,
    ({ status: MembershipStatus } & Record<string, unknown>) | undefined
  >;
}): Database {
  let sessionTenantId: string | undefined;
  let call = 0;

  const select = vi.fn().mockImplementation(() => {
    const isSessionCall = call === 0;
    call++;
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(async () => {
          if (isSessionCall) {
            sessionTenantId = opts.sessionRows[0]?.tenantId;
            return opts.sessionRows;
          }
          const row =
            sessionTenantId !== undefined
              ? opts.membershipsByTenant[sessionTenantId]
              : undefined;
          return row ? [row] : [];
        }),
      }),
    };
  });

  return { select } as unknown as Database;
}
