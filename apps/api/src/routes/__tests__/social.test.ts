import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { socialRoutes } from "../social.js";
import { SocialAuthService, type SocialServiceDeps } from "../../auth/social.js";
import { UnverifiedEmailError, type OidcProvider } from "../../auth/providers.js";

/**
 * Fake OIDC provider for the integration test. Mirrors the real provider
 * contract: getAuthorizationUrl embeds `state` in the URL, exchangeCode returns
 * a verified ProviderUser (or throws UnverifiedEmailError).
 */
function fakeProvider(opts: {
  state?: string;
  unverified?: boolean;
  email?: string;
  providerAccountId?: string;
}): OidcProvider {
  const state = opts.state ?? "int-state";
  const email = opts.email ?? "newuser@example.com";
  const providerAccountId = opts.providerAccountId ?? "google-acc-1";
  return {
    providerId: "google",
    getAuthorizationUrl: vi.fn(
      async () =>
        `https://accounts.google.com/o/oauth2/auth?state=${encodeURIComponent(
          state
        )}&code_challenge=stub`
    ),
    exchangeCode: vi.fn(async () => {
      if (opts.unverified) {
        throw new UnverifiedEmailError();
      }
      return {
        providerId: "google",
        providerAccountId,
        email,
        emailVerified: true,
      };
    }),
  };
}

function buildApp(provider: OidcProvider, depsOverrides?: Partial<SocialServiceDeps>) {
  const registry = {
    get: vi.fn(() => provider),
    list: vi.fn(() => ["google"]),
    register: vi.fn(),
  } as unknown as SocialServiceDeps["registry"];

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
      tenantName: "newuser's workspace",
    })),
    linkOauthToExistingUser: vi.fn(async () => undefined),
    createSession: vi.fn(async () => undefined),
    ...depsOverrides,
  };

  const service = new SocialAuthService(deps);
  return {
    service,
    deps,
    app: null as ReturnType<typeof Fastify> | null,
  };
}

describe("social routes (integration via app.inject)", () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    ctx = buildApp(fakeProvider({ state: "st-1" }));
  });
  afterEach(async () => {
    if (ctx.app) await ctx.app.close();
  });

  async function startApp(ctx: ReturnType<typeof buildApp>) {
    const app = Fastify();
    await app.register(socialRoutes, { socialAuthService: ctx.service });
    ctx.app = app;
    return app;
  }

  it("GET /auth/social/login?provider=google returns 200 with authorization URL + state", async () => {
    const app = await startApp(ctx);
    const res = await app.inject({ method: "GET", url: "/auth/social/login?provider=google" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.authorizationUrl).toContain("state=st-1");
    expect(body.state).toBe("st-1");
  });

  it("GET /auth/social/login without provider returns 422", async () => {
    const app = await startApp(ctx);
    const res = await app.inject({ method: "GET", url: "/auth/social/login" });
    expect(res.statusCode).toBe(422);
  });

  it("POST /auth/social/callback returns 200 SessionResponse for a new verified Google user (provisions account + session)", async () => {
    const app = await startApp(ctx);
    // initiate to record the state
    const loginRes = await app.inject({
      method: "GET",
      url: "/auth/social/login?provider=google",
    });
    const state = loginRes.json().state;

    const res = await app.inject({
      method: "POST",
      url: "/auth/social/callback",
      payload: { code: "the-code", state },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.id).toBe("user-new");
    expect(body.user.email).toBe("newuser@example.com");
    expect(body.tenant.id).toBe("tenant-new");
    expect(ctx.deps.createSession).toHaveBeenCalledTimes(1);
    expect(ctx.deps.provisionNewGoogleOnlyUser).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/social/callback links an existing user (no provisioning)", async () => {
    ctx = buildApp(fakeProvider({ state: "st-2", email: "existing@example.com" }), {
      findUserByEmail: vi.fn(async () => ({ id: "existing-user", email: "existing@example.com" })),
    });
    const app = await startApp(ctx);
    await app.inject({ method: "GET", url: "/auth/social/login?provider=google" });

    const res = await app.inject({
      method: "POST",
      url: "/auth/social/callback",
      payload: { code: "c", state: "st-2" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe("existing-user");
    expect(ctx.deps.linkOauthToExistingUser).toHaveBeenCalledWith(
      "existing-user",
      "google",
      "google-acc-1",
      "existing@example.com"
    );
    expect(ctx.deps.provisionNewGoogleOnlyUser).not.toHaveBeenCalled();
  });

  it("POST /auth/social/callback returns 400 when the provider email is unverified", async () => {
    ctx = buildApp(fakeProvider({ state: "st-3", unverified: true }));
    const app = await startApp(ctx);
    await app.inject({ method: "GET", url: "/auth/social/login?provider=google" });

    const res = await app.inject({
      method: "POST",
      url: "/auth/social/callback",
      payload: { code: "c", state: "st-3" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not verified/i);
    expect(ctx.deps.createSession).not.toHaveBeenCalled();
  });

  it("POST /auth/social/callback with an unknown state returns 400", async () => {
    const app = await startApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/auth/social/callback",
      payload: { code: "c", state: "never-recorded" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /auth/social/callback missing fields returns 422", async () => {
    const app = await startApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/auth/social/callback",
      payload: { code: "c" },
    });
    expect(res.statusCode).toBe(422);
  });
});