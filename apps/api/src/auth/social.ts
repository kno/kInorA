/**
 * Social auth service — orchestrates the OIDC provider abstraction with the
 * tenant-provisioning + session-issuance flow.
 *
 * This is the business-logic layer for Google-only sign-up and OAuth account
 * linking. It depends only on the {@link ProviderRegistry} port and on injected
 * persistence callbacks (the `SocialServiceDeps`), keeping it free of Drizzle /
 * `pg` imports so it stays within the API application layer (architecture rule:
 * `api-no-db-outside-infra`) and is unit-testable with plain function mocks.
 *
 * Flow (per spec "Google-only sign-up"):
 *   1. `login(providerId)` — resolves the provider, asks it for an
 *      authorization URL (PKCE + state), records `state -> providerId` so the
 *      callback can recover the provider without re-sending it.
 *   2. `callback({ code, state })` — exchanges the code for a verified
 *      `ProviderUser`, then:
 *        - if an oauth_account already exists for (provider,account) → reuse it,
 *        - else if a user exists with the same verified email → link the account,
 *        - else provision a new Google-only user (no password) + tenant + membership,
 *        - finally issue an opaque DB-backed session.
 */
import { createHash } from "node:crypto";
import type {
  ProviderRegistry,
  ProviderUser,
} from "./providers.js";
import { UnverifiedEmailError, UnknownProviderError } from "./providers.js";
import { generateToken } from "./session.js";
import type { SessionResponse, UserId, TenantId } from "@kinora/contracts";

/**
 * Session lifetime in milliseconds (30 days). Mirrors AuthService (PR2).
 * Once both PR2/PR3 merge, this constant and AuthService's should be unified.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deterministic SHA-256 token hash used as the session lookup key.
 *
 * Mirrors the lookup-hash scheme PR2's auth plugin uses to find sessions by
 * bearer token. Kept here (not in session.ts) to avoid touching PR1's
 * `session.ts` and conflicting with PR2's `computeTokenHash` addition on a
 * separate branch; consolidate into `session.ts` once PR2/PR3 land together.
 */
function hashTokenForLookup(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Persistence + provisioning ports the social service orchestrates.
 * Each is a thin function so this module stays drizzle-free and unit-testable.
 */
export interface SocialServiceDeps {
  /** OIDC provider registry, keyed by provider id. */
  registry: ProviderRegistry;
  /** Find a user by email (verified-email linking lookup). */
  findUserByEmail: (email: string) => Promise<{ id: string; email: string } | null>;
  /** Find an existing oauth_account row for this provider + provider account id. */
  findOauthByProviderAccount: (
    providerId: string,
    providerAccountId: string
  ) => Promise<{ userId: string | null } | null>;
  /** Find a membership for a user to resolve the session's tenant. */
  findMembershipByUserId: (userId: string) => Promise<{ tenantId: string } | null>;
  /** Find a tenant by id for the SessionResponse tenant name. */
  findTenantById: (id: string) => Promise<{ id: string; name: string } | null>;
  /** Provision a brand-new Google-only user (no password): tenant + user + membership + oauth_account link. */
  provisionNewGoogleOnlyUser: (
    providerId: string,
    providerAccountId: string,
    email: string
  ) => Promise<{ userId: string; tenantId: string; tenantName: string }>;
  /** Link an OAuth account to an existing user (does not create user/tenant). */
  linkOauthToExistingUser: (
    userId: string,
    providerId: string,
    providerAccountId: string,
    email: string
  ) => Promise<void>;
  /** Create an opaque DB-backed session keyed by a deterministic token hash. */
  createSession: (input: {
    tokenHash: string;
    userId: string;
    tenantId: string;
    expiresAt: Date;
  }) => Promise<void>;
}

/**
 * Auth-domain error for the social flow. Routes map this to an HTTP error.
 */
export class SocialAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = SocialAuthError.name;
  }
}

/**
 * Social auth service — provider-agnostic orchestration of OIDC login +
 * callback over injected persistence ports.
 */
export class SocialAuthService {
  /** state → providerId map populated by login, consumed by callback. */
  private readonly stateToProvider = new Map<string, string>();

  constructor(private readonly deps: SocialServiceDeps) {}

  /**
   * Initiate an OIDC login for `providerId`.
   * Returns the authorization URL (with PKCE + state) and the opaque state.
   */
  async login(providerId: string): Promise<{
    authorizationUrl: string;
    state: string;
  }> {
    let provider;
    try {
      provider = this.deps.registry.get(providerId);
    } catch (err) {
      throw new SocialAuthError(
        err instanceof Error ? err.message : "Unknown OIDC provider"
      );
    }

    const authorizationUrl = await provider.getAuthorizationUrl({});
    const state = new URL(authorizationUrl).searchParams.get("state");
    if (!state) {
      throw new SocialAuthError(
        "OIDC provider did not return a state parameter"
      );
    }

    this.stateToProvider.set(state, providerId);
    return { authorizationUrl, state };
  }

  /**
   * Complete an OIDC login given the callback `code` + `state`.
   * Resolves (provisioning, linking, or reusing an existing oauth account),
   * then issues a session and returns the {@link SessionResponse}.
   *
   * Cleans up the state→providerId map regardless of success or error to
   * prevent unbounded memory growth (each login call adds one entry).
   */
  async callback(input: {
    code: string;
    state: string;
  }): Promise<SessionResponse> {
    const providerId = this.stateToProvider.get(input.state);
    // Clean up the state entry immediately — it is single-use.
    this.stateToProvider.delete(input.state);

    if (!providerId) {
      throw new SocialAuthError("Unknown or expired social login state");
    }

    let providerUser: ProviderUser;
    const provider = this.deps.registry.get(providerId);
    try {
      providerUser = await provider.exchangeCode(input.code, input.state);
    } catch (err) {
      if (err instanceof UnverifiedEmailError) {
        throw new SocialAuthError("Provider email is not verified");
      }
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : "OIDC code exchange failed";
      console.error("[social] exchangeCode failed:", msg, err instanceof Error ? err.stack : "");
      throw new SocialAuthError(msg);
    }

    // Defensive: the resolved account MUST come from the same provider.
    if (providerUser.providerId !== providerId) {
      throw new SocialAuthError("OIDC provider mismatch on callback");
    }

    // Defensive: never trust a claim that wasn't verified, even if the provider
    // echoed `email_verified` only loosely.
    if (!providerUser.emailVerified) {
      throw new SocialAuthError("Provider email is not verified");
    }

    const context = await this.resolveUserTenantContext(providerUser);
    return this.issueSession(context);
  }

  /**
   * Normalize the three callback branches into a single user/tenant context.
   *
   * 1. OAuth account already exists → reuse it (any previous linking).
   * 2. User exists with same verified email → link OAuth account.
   * 3. New verified user (Google-only sign-up) → provision tenant + user + oauth_account.
   */
  private async resolveUserTenantContext(
    providerUser: ProviderUser
  ): Promise<{
    userId: string;
    tenantId: string;
    tenantName: string;
    email: string | undefined;
  }> {
    const existingOauth = await this.deps.findOauthByProviderAccount(
      providerUser.providerId,
      providerUser.providerAccountId
    );
    if (existingOauth?.userId) {
      return this.tenantContextFor(existingOauth.userId);
    }

    const existingUser = await this.deps.findUserByEmail(providerUser.email);
    if (existingUser) {
      await this.deps.linkOauthToExistingUser(
        existingUser.id,
        providerUser.providerId,
        providerUser.providerAccountId,
        providerUser.email
      );
      return this.tenantContextFor(existingUser.id);
    }

    const provisioned = await this.deps.provisionNewGoogleOnlyUser(
      providerUser.providerId,
      providerUser.providerAccountId,
      providerUser.email
    );
    return {
      userId: provisioned.userId,
      tenantId: provisioned.tenantId,
      tenantName: provisioned.tenantName,
      email: providerUser.email,
    };
  }

  /**
   * Resolve tenantId + tenantName for a user that already has a membership
   * (reused or linked OAuth account path).
   */
  private async tenantContextFor(userId: string): Promise<{
    userId: string;
    tenantId: string;
    tenantName: string;
    email: string | undefined;
  }> {
    const membership = await this.deps.findMembershipByUserId(userId);
    if (!membership) {
      throw new SocialAuthError("No active tenant membership found for user");
    }
    const tenant = await this.deps.findTenantById(membership.tenantId);
    if (!tenant) {
      throw new SocialAuthError("Tenant not found");
    }
    return {
      userId,
      tenantId: tenant.id,
      tenantName: tenant.name,
      email: undefined,
    };
  }

  /**
   * Issue an opaque DB-backed session and return the SessionResponse.
   * `email` is only carried through the new-user path; for existing users the
   * email is enriched later by PR2's auth plugin at request time.
   */
  private async issueSession(args: {
    userId: string;
    tenantId: string;
    tenantName: string;
    email: string | undefined;
  }): Promise<SessionResponse> {
    const token = generateToken();
    const tokenHash = hashTokenForLookup(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.deps.createSession({
      tokenHash,
      userId: args.userId,
      tenantId: args.tenantId,
      expiresAt,
    });

    return {
      token,
      user: {
        id: args.userId as unknown as UserId,
        email: args.email ?? "",
      },
      tenant: {
        id: args.tenantId as unknown as TenantId,
        name: args.tenantName,
      },
    };
  }
}

/**
 * Re-exported for wiring consumers (routes) and tests. Kept available so the
 * social wiring can map provider-registry errors to HTTP responses uniformly.
 */
export type { ProviderRegistry };
export { UnknownProviderError };