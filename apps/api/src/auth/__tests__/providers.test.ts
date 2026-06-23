import { describe, it, expect, vi, beforeEach } from "vitest";

// Boundary mock for the external `openid-client` library. Only the
// GoogleProvider glue exercises these; the pure registry + claims logic does
// not. Treated as a single library-boundary mock (mock hygiene: 1 boundary).
vi.mock("openid-client", () => ({
  discovery: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  authorizationCodeGrant: vi.fn(),
  randomPKCECodeVerifier: vi.fn(() => "verifier-stub"),
  calculatePKCECodeChallenge: vi.fn(async () => "challenge-stub"),
  randomState: vi.fn(() => "state-stub"),
}));

import {
  ProviderRegistry,
  UnknownProviderError,
  googleClaimsToProviderUser,
  UnverifiedEmailError,
  OidcClaimsError,
  GoogleProvider,
  type OidcProvider,
  type ProviderUser,
} from "../providers.js";

// ---------------------------------------------------------------------------
// Pure unit tests — zero mocks (mock hygiene: extract logic, test directly)
// ---------------------------------------------------------------------------

describe("ProviderRegistry", () => {
  it("returns a registered provider by its id", () => {
    const registry = new ProviderRegistry();
    const fake: OidcProvider = {
      providerId: "google",
      getAuthorizationUrl: vi.fn(),
      exchangeCode: vi.fn(),
    };
    registry.register(fake);

    expect(registry.get("google")).toBe(fake);
    expect(registry.list()).toEqual(["google"]);
  });

  it("throws UnknownProviderError when requesting an unregistered provider", () => {
    const registry = new ProviderRegistry();

    expect(() => registry.get("unknown")).toThrow(UnknownProviderError);
  });

  // Triangulation: a second provider resolves independently from the first
  it("registers and resolves a second provider independently", () => {
    const registry = new ProviderRegistry();
    const google: OidcProvider = {
      providerId: "google",
      getAuthorizationUrl: vi.fn(),
      exchangeCode: vi.fn(),
    };
    const github: OidcProvider = {
      providerId: "github",
      getAuthorizationUrl: vi.fn(),
      exchangeCode: vi.fn(),
    };
    registry.register(google);
    registry.register(github);

    expect(registry.get("github")).toBe(github);
    expect(registry.list().sort()).toEqual(["github", "google"]);
  });
});

describe("googleClaimsToProviderUser (pure claims → ProviderUser)", () => {
  it("maps valid verified-email claims to a ProviderUser", () => {
    const claims = {
      sub: "google-account-123",
      email: "owner@example.com",
      email_verified: true,
    };

    const result = googleClaimsToProviderUser(claims);

    expect(result).toEqual({
      providerId: "google",
      providerAccountId: "google-account-123",
      email: "owner@example.com",
      emailVerified: true,
    });
  });

  // Triangle: unverified email MUST be rejected (spec: BLOCK on email_verified)
  it("throws UnverifiedEmailError when email_verified is not true", () => {
    const claims = {
      sub: "google-account-123",
      email: "unverified@example.com",
      email_verified: false,
    };

    expect(() => googleClaimsToProviderUser(claims)).toThrow(UnverifiedEmailError);
  });

  // Triangle: email_verified true but missing email in claims
  it("throws OidcClaimsError when email is missing from claims", () => {
    const claims = { sub: "google-account-123", email_verified: true };

    expect(() => googleClaimsToProviderUser(claims)).toThrow(OidcClaimsError);
  });

  // Triangle: missing sub (provider account id)
  it("throws OidcClaimsError when sub is missing from claims", () => {
    const claims = { email: "owner@example.com", email_verified: true };

    expect(() => googleClaimsToProviderUser(claims as unknown as Record<string, unknown>)).toThrow(OidcClaimsError);
  });

  // Triangulation: a second valid set of claims produces a different ProviderUser
  it("maps a second distinct identity without cross-contamination", () => {
    const a = googleClaimsToProviderUser({
      sub: "sub-aaa",
      email: "a@example.com",
      email_verified: true,
    });
    const b = googleClaimsToProviderUser({
      sub: "sub-bbb",
      email: "b@example.com",
      email_verified: true,
    });

    expect(a.providerAccountId).toBe("sub-aaa");
    expect(b.providerAccountId).toBe("sub-bbb");
    expect(a.email).toBe("a@example.com");
    expect(b.email).toBe("b@example.com");
  });
});

// ---------------------------------------------------------------------------
// Integration-style GoogleProvider glue — openid-client boundary is mocked.
// One test exercises the full getAuthorizationUrl → exchangeCode flow.
// ---------------------------------------------------------------------------

describe("GoogleProvider (openid-client mocked)", () => {
  let oidc: typeof import("openid-client");

  beforeEach(async () => {
    oidc = await import("openid-client");
  });

  it("getAuthorizationUrl returns a URL embedding state + PKCE challenge and exchangeCode returns a verified ProviderUser", async () => {
    const buildSpy = oidc.buildAuthorizationUrl as ReturnType<typeof vi.fn>;
    buildSpy.mockImplementation((_config: unknown, params: Record<string, string>) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      return url;
    });

    const grantSpy = oidc.authorizationCodeGrant as ReturnType<typeof vi.fn>;
    grantSpy.mockResolvedValue({
      claims: () => ({
        sub: "google-account-xyz",
        email: "user@example.com",
        email_verified: true,
      }),
    });

    const provider = new GoogleProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://app.example.com/callback/social",
    });

    const url = await provider.getAuthorizationUrl({});

    expect(url).toContain("state=state-stub");
    expect(url).toContain("code_challenge=challenge-stub");
    expect(url).toContain("code_challenge_method=S256");

    const user: ProviderUser = await provider.exchangeCode("the-code", "state-stub");

    expect(user).toEqual({
      providerId: "google",
      providerAccountId: "google-account-xyz",
      email: "user@example.com",
      emailVerified: true,
    });
  });
});