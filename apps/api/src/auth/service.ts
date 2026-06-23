import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { users, credentials, memberships, tenants, sessions } from "../db/schema.js";
import { provisionTenantForUser } from "../tenant/provisioning.js";
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  PasswordPolicyError,
} from "@kinora/domain";
import { generateToken, computeTokenHash } from "./session.js";
import type {
  RegisterRequest,
  LoginRequest,
  SessionResponse,
  UserId,
  TenantId,
} from "@kinora/contracts";

/**
 * Session lifetime in milliseconds (30 days).
 * Open question in design: TTL-based cleanup vs explicit logout.
 * V1 uses a fixed 30-day expiry with explicit logout.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Derive a default personal-workspace tenant name from the email local part.
 */
function deriveTenantName(email: string): string {
  const localPart = email.split("@")[0];
  return localPart ? `${localPart}'s workspace` : "My workspace";
}

export class AuthService {
  constructor(private db: Database) {}

  /**
   * Register a new user: provision tenant + user + membership,
   * create password credentials, create session, return token.
   */
  async register(input: RegisterRequest): Promise<SessionResponse> {
    // 1. Validate password policy before any db operation
    const validPassword = validatePasswordPolicy(input.password);

    // 2. Derive tenant name from email
    const tenantName = deriveTenantName(input.email);

    // 3. Provision tenant + user + owner membership (transaction)
    const provisioned = await provisionTenantForUser(this.db, {
      tenantName,
      userEmail: input.email,
    });

    // 4. Hash password and create credentials
    const passwordHash = hashPassword(validPassword);
    await this.db.insert(credentials).values({
      userId: provisioned.userId,
      passwordHash,
    });

    // 5. Generate session token, hash deterministically for lookup, create session
    const token = generateToken();
    const tokenHash = computeTokenHash(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(sessions).values({
      tokenHash,
      userId: provisioned.userId,
      tenantId: provisioned.tenantId,
      expiresAt,
    });

    // 6. Return SessionResponse
    return {
      token,
      user: {
        id: provisioned.userId as UserId,
        email: input.email,
      },
      tenant: {
        id: provisioned.tenantId as TenantId,
        name: tenantName,
      },
    };
  }
}