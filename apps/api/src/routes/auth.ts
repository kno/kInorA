import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AuthService, AuthError } from "../auth/service.js";
import type { RegisterRequest, LoginRequest } from "@kinora/contracts";

/**
 * Plugin options: the auth service instance to delegate register/login to.
 */
export interface AuthRoutesOptions {
  authService: AuthService;
}

/**
 * JSON schema for RegisterRequest body validation.
 * Fastify uses ajv under the hood; missing required fields trigger
 * a validation error that the app error handler converts to 422.
 */
const registerSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 8 },
    },
    additionalProperties: false,
  },
};

/**
 * JSON schema for LoginRequest body validation.
 */
const loginSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string" },
    },
    additionalProperties: false,
  },
};

/**
 * Auth route plugin — registers POST /auth/register and POST /auth/login.
 *
 * Each route validates the body via JSON schema, delegates to AuthService,
 * and returns a SessionResponse. AuthErrors propagate to the app-level
 * error handler which maps them to 401.
 */
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  fastify,
  options
) => {
  const { authService } = options;

  fastify.post(
    "/auth/register",
    { schema: registerSchema },
    async (request: FastifyRequest<{ Body: RegisterRequest }>) => {
      return authService.register(request.body);
    }
  );

  fastify.post(
    "/auth/login",
    { schema: loginSchema },
    async (request: FastifyRequest<{ Body: LoginRequest }>) => {
      return authService.login(request.body);
    }
  );
};

// Re-export AuthError so the app error handler can check the name
export { AuthError };