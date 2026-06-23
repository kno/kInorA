import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OidcProvider, ProviderUser, AuthUrlParams } from "../providers.js";
import { UnverifiedEmailError } from "../providers.js";
import {
  SocialAuthService,
  SocialAuthError,
  type SocialServiceDeps,
} from "../social.js";

/**
 * In-memory fake OIDC provider for social service orchestration tests.
 * It owns no library boundary — it simulates the provider contract:
 * getAuthorizationUrl embeds the configured `state` into a URL, and
 * exchangeCode returns a predetermined ProviderUser (or throws).
 */
function fakeProvider(opts: {
  providerId: string;
  state?: string;
  providerUser?: ProviderUser;
  throwUnverified?: boolean;
}): OidcProvider & {
  exchangeCode: ReturnType<typeof vi.fn>;
  getAuthorizationUrl: ReturnType<typeof vi.fn>;
} {
  const state = opts.state ?? "state-123";
  const providerUser: ProviderUser =
    opts.providerUser ?? {
      providerId: opts.providerId,
      providerAccountId: "google-account-abc",
      email: "new@example.com",
      emailVerified: true,
    };
  return {
    providerId: opts.providerId,
    getAuthorizationUrl: vi.fn(
      async (_params: AuthUrlParams) =>
        `https://accounts.google.com/o/oauth2/auth?state=${encodeURIComponent(state)}&code_challenge=stub`
    ),
    exchangeCode: vi.fn(async () => {
      if (opts.throwUnverified) {
        throw new UnverifiedEmailError();
      }
      return providerUser;
    }),
  };
}

/**
 * Build an in-memory SocialAuthService with injected mock deps.
 * Each dep is a vi.fn so tests can assert call order and arguments.
 */
function defaultRegistry(
  provider: OidcProvider,
  registryProviders?: OidcProvider[]
): SocialServiceDeps["registry"] {
  const all = registryProviders ?? [provider];
  return {
    get: vi.fn((id: string) => {
      const found = all.find((p) => p.providerId === id);
      if (!found) throw new Error(`Unknown provider ${id}`);
      return found;
    }),
    list: vi.fn(() => all.map((p) => p.providerId)),
    register: vi.fn(),
  } as unknown as SocialServiceDeps["registry"];
}

function buildService(
  provider: OidcProvider,
  overrides?: Partial<SocialServiceDeps> & { registryProviders?: OidcProvider[] }
) {
  const registry =
    overrides?.registry ?? defaultRegistry(provider, overrides?.registryProviders);

  const deps: SocialServiceDeps = {
    registry,
    findUserByEmail: vi.fn(async () => null),
    findOauthByProviderAccount: vi.fn(async () => null),
    findMembershipByUserId: vi.fn(async () => ({ tenantId: "tenant-1" })),
    findTenantById: vi.fn(async () => ({
      id: "tenant-1",
      name: "owner's workspace",
    })),
    provisionNewGoogleOnlyUser: vi.fn(async () => ({
      userId: "user-new",
      tenantId: "tenant-new",
      tenantName: "new's workspace",
    })),
    linkOauthToExistingUser: vi.fn(async () => undefined),
    createSession: vi.fn(async () => undefined),
    ...overrides,
  };

  const service = new SocialAuthService(deps);

  return { service, deps };
}

describe("SocialAuthService.login", () => {
  it("returns the provider authorization URL and records the provider for the state", async () => {
    const provider = fakeProvider({ providerId: "google", state: "state-xyz" });
    const { service, deps } = buildService(provider);

    const result = await service.login("google");

    expect(result.authorizationUrl).toContain("state=state-xyz");
    expect(result.state).toBe("state-xyz");
    // Verify the state was stored so the callback can resolve the provider.
    // (Indirect: run a callback with the same state and confirm google is queried.)
    deps.findUserByEmail = vi.fn(async () => null);
    await service.callback({ code: "c", state: "state-xyz" });
    expect(provider.exchangeCode).toHaveBeenCalledWith("c", "state-xyz");
  });

  it("throws SocialAuthError for an unknown provider id", async () => {
    const provider = fakeProvider({ providerId: "google" });
    const { service } = buildService(provider, {
      registry: {
        get: vi.fn(() => {
          throw new Error("not found");
        }),
        list: vi.fn(),
        register: vi.fn(),
      } as unknown as SocialServiceDeps["registry"],
    });

    await expect(service.login("apple")).rejects.toThrow(SocialAuthError);
  });
});

describe("SocialAuthService.callback", () => {
  // Scenario: Google-only sign-up creates account and session
  it("creates a new user account + session for a verified new Google user", async () => {
    const provider = fakeProvider({ providerId: "google", state: "s1" });
    const { service, deps } = buildService(provider);
    await service.login("google");

    const response = await service.callback({ code: "the-code", state: "s1" });

    // Provisioned a Google-only user (no password) + linked oauth account
    expect(deps.provisionNewGoogleOnlyUser).toHaveBeenCalledWith(
      "google",
      "google-account-abc",
      "new@example.com"
    );
    // Issued a session keyed by a deterministic token hash
    expect(deps.createSession).toHaveBeenCalledTimes(1);
    const sessionArg = (deps.createSession as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(sessionArg.userId).toBe("user-new");
    expect(sessionArg.tenantId).toBe("tenant-new");
    expect(typeof sessionArg.tokenHash).toBe("string");
    // Session response echoes the new identity + tenant
    expect(response.user.email).toBe("new@example.com");
    expect(response.tenant.id).toBe("tenant-new");
    expect(typeof response.token).toBe("string");
    // Link was NOT called (brand-new user, not linking to an existing one)
    expect(deps.linkOauthToExistingUser).not.toHaveBeenCalled();
  });

  // Scenario: existing user links OAuth account
  it("links an OAuth account to an existing user found by verified email", async () => {
    const provider = fakeProvider({ providerId: "google", state: "s2" });
    const { service, deps } = buildService(provider, {
      findUserByEmail: vi.fn(async () => ({ id: "existing-user", email: "new@example.com" })),
    });
    await service.login("google");

    const response = await service.callback({ code: "c", state: "s2" });

    // Linked the OAuth account to the existing user (did not provision anew)
    expect(deps.linkOauthToExistingUser).toHaveBeenCalledWith(
      "existing-user",
      "google",
      "google-account-abc",
      "new@example.com"
    );
    expect(deps.provisionNewGoogleOnlyUser).not.toHaveBeenCalled();
    // Session issued for the existing user's tenant
    expect(deps.findMembershipByUserId).toHaveBeenCalledWith("existing-user");
    const sessionArg = (deps.createSession as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(sessionArg.userId).toBe("existing-user");
    expect(sessionArg.tenantId).toBe("tenant-1");
    expect(response.user.id).toBe("existing-user");
    expect(response.tenant.name).toBe("owner's workspace");
  });

  it("reuses an already-linked OAuth account without provisioning or linking again", async () => {
    const provider = fakeProvider({ providerId: "google", state: "s3" });
    const { service, deps } = buildService(provider, {
      findOauthByProviderAccount: vi.fn(async () => ({ userId: "linked-user" })),
    });
    await service.login("google");

    const response = await service.callback({ code: "c", state: "s3" });

    expect(deps.provisionNewGoogleOnlyUser).not.toHaveBeenCalled();
    expect(deps.linkOauthToExistingUser).not.toHaveBeenCalled();
    expect(deps.findMembershipByUserId).toHaveBeenCalledWith("linked-user");
    expect(response.user.id).toBe("linked-user");
  });

  // Triangle: unverified email rejected for new user (spec BLOCK)
  it("rejects an unverified Google email and never provisions nor issues a session", async () => {
    const provider = fakeProvider({ providerId: "google", state: "s4", throwUnverified: true });
    const { service, deps } = buildService(provider);
    await service.login("google");

    await expect(
      service.callback({ code: "c", state: "s4" })
    ).rejects.toThrow(SocialAuthError);

    expect(deps.provisionNewGoogleOnlyUser).not.toHaveBeenCalled();
    expect(deps.linkOauthToExistingUser).not.toHaveBeenCalled();
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  // Triangle: provider mismatch — callback state maps to provider A but the
  // resolved ProviderUser claims a different provider id.
  it("rejects a provider mismatch between the login state and the resolved account", async () => {
    const provider = fakeProvider({
      providerId: "google",
      state: "s5",
      providerUser: {
        providerId: "github",
        providerAccountId: "gh-acc",
        email: "mismatch@example.com",
        emailVerified: true,
      },
    });
    const { service, deps } = buildService(provider);
    await service.login("google");

    await expect(
      service.callback({ code: "c", state: "s5" })
    ).rejects.toThrow(SocialAuthError);

    expect(deps.createSession).not.toHaveBeenCalled();
  });

  // Triangle: unknown / expired state (no prior login recorded it)
  it("rejects an unknown state that no prior login recorded", async () => {
    const provider = fakeProvider({ providerId: "google" });
    const { service, deps } = buildService(provider);

    await expect(
      service.callback({ code: "c", state: "never-recorded" })
    ).rejects.toThrow(SocialAuthError);

    expect(provider.exchangeCode).not.toHaveBeenCalled();
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  // Triangle: race condition on concurrent callback — the second callback
  // observes the OAuth row committed by the first and reuses it instead of
  // provisioning a duplicate user.
  it("reuses an OAuth row committed by a concurrent callback instead of provisioning again", async () => {
    const provider = fakeProvider({ providerId: "google", state: "s6" });
    const { service, deps } = buildService(provider, {
      // Simulate the first callback committing the oauth account; the second
      // observes it via findOauthByProviderAccount.
      findOauthByProviderAccount: vi.fn(async () => null),
      findUserByEmail: vi.fn(async () => null),
    });
    await service.login("google");

    // First callback: new user provisioning path
    await service.callback({ code: "first", state: "s6" });
    expect(deps.provisionNewGoogleOnlyUser).toHaveBeenCalledTimes(1);

    // Simulate the race: the oauth row now exists (committed by first callback)
    (deps.findOauthByProviderAccount as ReturnType<typeof vi.fn>).mockResolvedValue(
      { userId: "user-new" }
    );
    // Same state cannot be reused (verifier consumed); simulate a second login
    // with a fresh state for the same concurrent flow.
    provider.getAuthorizationUrl = vi.fn(
      async () =>
        "https://accounts.google.com/o/oauth2/auth?state=s6b&code_challenge=stub"
    );
    await service.login("google");
    const second = await service.callback({ code: "second", state: "s6b" });

    expect(second.user.id).toBe("user-new");
    // Provision must NOT repeat — the row already existed
    expect(deps.provisionNewGoogleOnlyUser).toHaveBeenCalledTimes(1);
    expect(deps.linkOauthToExistingUser).not.toHaveBeenCalled();
  });
});