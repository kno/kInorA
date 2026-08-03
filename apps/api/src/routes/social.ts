import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type {
  OidcCallbackParams,
  SocialCallbackResponse,
  SocialLoginResponse,
} from "@kinora/contracts";
import {
  SocialAuthService,
  SocialAuthError,
} from "../auth/social.js";
import { UnknownProviderError } from "../auth/providers.js";

/**
 * Plugin options: the social auth service instance to delegate login + callback to.
 */
export interface SocialRoutesOptions {
  socialAuthService: SocialAuthService;
}

const loginSchema = {
  querystring: {
    type: "object",
    required: ["provider"],
    properties: {
      provider: { type: "string", minLength: 1 },
      // Optional gym subdomain the login was initiated from. Accepted as a
      // free string here (so a malformed value never 422s the whole login);
      // it is validated against ORIGIN_SLUG_PATTERN below and, if it fails,
      // treated as none — the login still proceeds from the apex.
      originSlug: { type: "string" },
    },
    additionalProperties: false,
  },
};

/**
 * A single DNS label: lowercase alphanumerics + hyphens, 1..63 chars. Mirrors
 * the web `extractGymSlugFromHost` allow-list so a slug that round-trips
 * through the OAuth state can only ever be a bare subdomain label — never a
 * host, path, or URL that could drive an open redirect on the way back.
 */
const ORIGIN_SLUG_PATTERN = /^[a-z0-9-]{1,63}$/;

/**
 * Normalize a raw `originSlug` query param to a safe single-label slug or
 * `undefined`. Invalid shapes (empty, wrong chars, too long, `www`) are
 * treated as none rather than rejected.
 */
function sanitizeOriginSlug(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const slug = raw.trim().toLowerCase();
  if (!ORIGIN_SLUG_PATTERN.test(slug)) return undefined;
  if (slug === "www") return undefined;
  return slug;
}

const callbackSchema = {
  body: {
    type: "object",
    required: ["code", "state"],
    properties: {
      code: { type: "string", minLength: 1 },
      state: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
};

/**
 * Social login route plugin — registers the two OIDC endpoints:
 *
 * - `GET /auth/social/login?provider=<id>` — initiates an OIDC flow, returning
 *   the provider authorization URL (with PKCE + state).
 * - `POST /auth/social/callback` — exchanges a `code` + `state` for tokens,
 *   resolves/links/provisions the account, and issues a session.
 *
 * `SocialAuthError` (unknown provider, unverified email, unknown state,
 * provider mismatch) and `UnknownProviderError` map to HTTP 400. Missing or
 * invalid fields map to 422 via Fastify validation.
 */
export const socialRoutes: FastifyPluginAsync<SocialRoutesOptions> = async (
  fastify,
  options
) => {
  const { socialAuthService } = options;

  // Register routes on a child instance so the scoped error handler only covers
  // social routes, not the parent app. Errors that do not match the social-auth
  // patterns fall through to the app-level handler.
  await fastify.register(async (scoped) => {
    scoped.setErrorHandler((error: unknown, _request, reply) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "validation" in error &&
        Boolean((error as { validation: unknown }).validation)
      ) {
        return reply.code(422).send({ error: "Validation Error" });
      }
      if (error instanceof SocialAuthError || error instanceof UnknownProviderError) {
        fastify.log.error(error, "Social auth error");
        return reply.code(400).send({ error: error.message });
      }
      // Let unknown errors propagate to the parent (app-level) error handler.
      throw error;
    });

    scoped.get(
      "/auth/social/login",
      { schema: loginSchema },
      async (
        request: FastifyRequest<{
          Querystring: { provider: string; originSlug?: string };
        }>,
      ) => {
        const originSlug = sanitizeOriginSlug(request.query.originSlug);
        const result: SocialLoginResponse = await socialAuthService.login(
          request.query.provider,
          originSlug
        );
        return result;
      }
    );

    scoped.post(
      "/auth/social/callback",
      { schema: callbackSchema },
      async (
        request: FastifyRequest<{ Body: OidcCallbackParams }>,
      ) => {
        const result: SocialCallbackResponse = await socialAuthService.callback(
          request.body
        );
        return result;
      }
    );
  });
};