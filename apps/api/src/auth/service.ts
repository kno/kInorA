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

  /**
   * Login: verify password against stored hash, create session, return token.
   * Throws AuthError for unknown email, wrong password, or social-only accounts
   * (generic message prevents user enumeration).
   */
  async login(input: LoginRequest): Promise<SessionResponse> {
    // 1. Find user by email
    const userRows = await this.db.select().from(users).where(eq(users.email, input.email));
    const user = userRows[0];
    if (!user) {
      throw new AuthError("Invalid email or password");
    }

    // 2. Find password credentials
    const credRows = await this.db.select().from(credentials).where(eq(credentials.userId, user.id));
    const cred = credRows[0];
    if (!cred) {
      // Social-only account — no password set
      throw new AuthError("Invalid email or password");
    }

    // 3. Verify password (constant-time compare)
    if (!verifyPassword(input.password, cred.passwordHash)) {
      throw new AuthError("Invalid email or password");
    }

    // 4. Find an active membership to get the tenant context
    const memberRows = await this.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id));
    const membership = memberRows[0];
    if (!membership) {
      throw new AuthError("No active tenant membership found for user");
    }

    // 5. Find tenant by id for the response
    const tenantRows = await this.db.select().from(tenants).where(eq(tenants.id, membership.tenantId));
    const tenant = tenantRows[0];
    if (!tenant) {
      throw new AuthError("Tenant not found");
    }

    // 6. Create session
    const token = generateToken();
    const tokenHash = computeTokenHash(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(sessions).values({
      tokenHash,
      userId: user.id,
      tenantId: membership.tenantId,
      expiresAt,
    });

    // 7. Return SessionResponse
    return {
      token,
      user: {
        id: user.id as UserId,
        email: user.email,
      },
      tenant: {
        id: membership.tenantId as TenantId,
        name: tenant.name,
      },
    };
  }

  /**
   * Logout: delete a session by its token hash.
   * `sessionId` is the deterministic token hash stored on the session record.
   */
  async logout(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, sessionId));
  }
}