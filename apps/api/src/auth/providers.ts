/**
 * OIDC Provider abstraction — provider-agnostic social login registry.
 *
 * Each provider (Google first) registers OIDC issuer metadata + client config.
 * Adding a provider means a config entry + OIDC issuer metadata, not flow
 * changes. The {@link ProviderRegistry} is queried by `providerId` at request
 * time; the {@link GoogleProvider} is the first concrete implementation and owns
 * the `openid-client` boundary (the only external library this module touches).
 *
 * Pure claims-mapping logic ({@link googleClaimsToProviderUser}) is extracted so
 * it can be unit-tested without mocking the OIDC library (mock hygiene:
 * extract logic, test directly).
 */
import {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
  randomState,
  type Configuration,
} from "openid-client";

/**
 * Default Google issuer metadata discovery URL.
 * Used unless overridden via {@link GoogleProviderConfig.issuer}.
 */
export const GOOGLE_ISSUER = "https://accounts.google.com";

/**
 * Fine-grained access scopes requested for Google OIDC. `email` is required for
 * the verified-email check; `openid` is the OIDC baseline; `profile` gives the
 * account a displayable name fallback (currently unused but conventional).
 */
const DEFAULT_SCOPES = "openid email profile";

/**
 * Identity resolved from an OIDC provider after a successful code exchange.
 * `emailVerified` MUST be `true` before a session is ever issued.
 */
export interface ProviderUser {
  providerId: string;
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Optional parameters for authorization-URL construction.
 * All values default to provider config when omitted.
 */
export interface AuthUrlParams {
  /** Override the configured redirect URI for this request. */
  redirectUri?: string;
  /** Override the requested scopes (space-delimited). */
  scope?: string;
}

/**
 * A pluggable OIDC provider. Implementations register at startup and are looked
 * up by {@link OidcProvider.providerId} via {@link ProviderRegistry.get}.
 */
export interface OidcProvider {
  readonly providerId: string;
  /**
   * Build the provider authorization URL embedding PKCE + state.
   * The returned string is the full URL the user-agent should be redirected to.
   */
  getAuthorizationUrl(params: AuthUrlParams): Promise<string>;
  /**
   * Exchange an authorization code for the authenticated user identity.
   * The `state` MUST match the state embedded in the authorization URL.
   * Throws {@link UnverifiedEmailError} when the provider email is not verified.
   */
  exchangeCode(code: string, state: string): Promise<ProviderUser>;
}

/**
 * Thrown when a provider id is requested that no provider was registered for.
 */
export class UnknownProviderError extends Error {
  constructor(providerId: string) {
    super(`Unknown OIDC provider: ${providerId}`);
    this.name = "UnknownProviderError";
  }
}

/**
 * Thrown when an OIDC provider returns an email that is not marked as verified.
 * The spec BLOCKs account creation/session issuance on unverified emails.
 */
export class UnverifiedEmailError extends Error {
  constructor(message = "OIDC provider returned an unverified email") {
    super(message);
    this.name = "UnverifiedEmailError";
  }
}

/**
 * Thrown when required claims (e.g. `sub`, `email`) are missing from the
 * OIDC ID Token.
 */
export class OidcClaimsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcClaimsError";
  }
}

/**
 * Provider-agnostic registry of OIDC providers keyed by `providerId`.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, OidcProvider>();

  /** Register (or replace) a provider keyed by its `providerId`. */
  register(provider: OidcProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  /** Resolve a provider by id, throwing {@link UnknownProviderError} if absent. */
  get(providerId: string): OidcProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new UnknownProviderError(providerId);
    }
    return provider;
  }

  /** List all registered provider ids (insertion order). */
  list(): string[] {
    return [...this.providers.keys()];
  }
}

/**
 * Map raw Google OIDC ID Token claims into a {@link ProviderUser}.
 *
 * Pure function — no library, no network, no IO. This is the logic extracted
 * from the {@link GoogleProvider} glue so it can be tested directly (mock
 * hygiene: test the logic, mock only the library boundary).
 *
 * Invariants enforced:
 * - `sub` MUST be present (provider account id) — else {@link OidcClaimsError}.
 * - `email` MUST be present — else {@link OidcClaimsError}.
 * - `email_verified` MUST be strictly `true` — else {@link UnverifiedEmailError}.
 */
export function googleClaimsToProviderUser(
  claims: Record<string, unknown>
): ProviderUser {
  const sub = claims.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new OidcClaimsError("OIDC claims missing required 'sub' claim");
  }

  const email = claims.email;
  if (typeof email !== "string" || email.length === 0) {
    throw new OidcClaimsError("OIDC claims missing required 'email' claim");
  }

  // Strict boolean true — Google echoes `email_verified: true`. Reject
  // truthy-but-not-true (e.g. "true" string) to avoid accidental verification.
  if (claims.email_verified !== true) {
    throw new UnverifiedEmailError();
  }

  return {
    providerId: "google",
    providerAccountId: sub,
    email,
    emailVerified: true,
  };
}

/**
 * Configuration for the Google OIDC provider, typically sourced from env vars.
 */
export interface GoogleProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Override the issuer (tests / alternate tenants). Defaults to Google. */
  issuer?: string;
}

/**
 * Google OIDC provider implementation built on `openid-client`.
 *
 * PKCE + state are generated per authorization request and cached in-memory
 * keyed by `state` so {@link exchangeCode} can recover the `code_verifier`
 * without exposing it to the client (the verifier never leaves the server).
 *
 * Token exchange validates `state` matches and translates the resulting claims
 * via {@link googleClaimsToProviderUser}, enforcing the verified-email invariant.
 */
export class GoogleProvider implements OidcProvider {
  readonly providerId = "google";

  /** state → code_verifier cache for PKCE redemption across the callback. */
  private readonly verifiers = new Map<string, string>();
  /** Discovered OIDC configuration (discovery runs once, lazily). */
  private discovered?: Configuration;

  constructor(private readonly config: GoogleProviderConfig) {}

  private async ensureDiscovered(): Promise<Configuration> {
    if (this.discovered) {
      return this.discovered;
    }
    const issuer = this.config.issuer ?? GOOGLE_ISSUER;
    // Passing the client secret as the metadata string is the openid-client
    // shorthand for ClientSecretPost auth at the token endpoint.
    this.discovered = await discovery(
      new URL(issuer),
      this.config.clientId,
      this.config.clientSecret
    );
    return this.discovered;
  }

  async getAuthorizationUrl(params: AuthUrlParams = {}): Promise<string> {
    const configuration = await this.ensureDiscovered();

    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomState();

    // Keep the verifier server-side; it is redeemed at callback time.
    this.verifiers.set(state, codeVerifier);

    const url = buildAuthorizationUrl(configuration, {
      redirect_uri: params.redirectUri ?? this.config.redirectUri,
      scope: params.scope ?? DEFAULT_SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    return url.toString();
  }

  async exchangeCode(code: string, state: string): Promise<ProviderUser> {
    const configuration = await this.ensureDiscovered();
    const codeVerifier = this.verifiers.get(state);
    if (codeVerifier === undefined) {
      throw new OidcClaimsError(
        "Unknown or expired OIDC state — cannot redeem authorization code"
      );
    }

    const callbackUrl = new URL(this.config.redirectUri);
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("state", state);

    try {
      const tokens = await authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: state,
        pkceCodeVerifier: codeVerifier,
      });

      const claims = tokens.claims();
      if (!claims) {
        throw new OidcClaimsError("OIDC token response missing ID Token claims");
      }

      return googleClaimsToProviderUser(claims as Record<string, unknown>);
    } finally {
      // Verifier is single-use; always delete once the state has been consumed,
      // regardless of success or error, to prevent unbounded memory growth.
      this.verifiers.delete(state);
    }
  }
}

/**
 * Build a provider registry from environment variables.
 *
 * Google is registered only when its env vars are present (a missing provider
 * is simply not registered, so requesting it raises {@link UnknownProviderError}
 * rather than crashing startup). New providers are additive config entries.
 */
export function createProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderRegistry {
  const registry = new ProviderRegistry();

  const googleClientId = env.GOOGLE_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET;
  const googleRedirectUri =
    env.GOOGLE_REDIRECT_URI ?? env.OIDC_REDIRECT_URI;

  if (googleClientId && googleClientSecret && googleRedirectUri) {
    registry.register(
      new GoogleProvider({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri,
      })
    );
  }

  return registry;
}