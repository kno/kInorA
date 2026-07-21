import type { Database } from "../db/client.js";
import { provisionTenantForUser } from "../tenant/provisioning.js";
import { CredentialsRepository } from "../db/repositories/credentials.js";
import {
  UserRepository,
  MembershipRepository,
  TenantLookupRepository,
} from "../db/repositories/auth-context.js";
import { SessionRepository } from "../db/repositories/session.js";
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
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
  private credRepo: CredentialsRepository;
  private userRepo: UserRepository;
  private memberRepo: MembershipRepository;
  private tenantRepo: TenantLookupRepository;
  private sessionRepo: SessionRepository;

  constructor(private db: Database) {
    this.credRepo = new CredentialsRepository(db);
    this.userRepo = new UserRepository(db);
    this.memberRepo = new MembershipRepository(db);
    this.tenantRepo = new TenantLookupRepository(db);
    this.sessionRepo = new SessionRepository(db);
  }

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
    await this.credRepo.create({
      userId: provisioned.userId,
      passwordHash,
    });

    // 5. Generate session token, hash deterministically for lookup, create session
    const token = generateToken();
    const tokenHash = computeTokenHash(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessionRepo.create({
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
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      throw new AuthError("Invalid email or password");
    }

    // 2. Find password credentials
    const cred = await this.credRepo.findByUserId(user.id);
    if (!cred) {
      // Social-only account — no password set
      throw new AuthError("Invalid email or password");
    }

    // 3. Verify password (constant-time compare)
    if (!verifyPassword(input.password, cred.passwordHash)) {
      throw new AuthError("Invalid email or password");
    }

    // 4. Find an active membership to get the tenant context.
    // Fail-secure: only status === "active" memberships may obtain a session.
    // Suspended or invited users are rejected here before any session is created.
    const membership = await this.memberRepo.findActiveByUserId(user.id);
    if (!membership) {
      throw new AuthError("No active tenant membership found for user");
    }

    // 5. Find tenant by id for the response
    const tenant = await this.tenantRepo.findById(membership.tenantId);
    if (!tenant) {
      throw new AuthError("Tenant not found");
    }

    // 6. Create session
    const token = generateToken();
    const tokenHash = computeTokenHash(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessionRepo.create({
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
    await this.sessionRepo.delete(sessionId);
  }

  /**
   * Get the user's profile for sidebar display.
   * Returns `null` when the user is not found.
   */
  async getProfile(
    userId: string,
  ): Promise<{ email: string; initials: string } | null> {
    const user = await this.userRepo.findById(userId);
    if (!user) return null;
    const emailLocal = user.email.split("@")[0] ?? "";
    const initials = emailLocal.charAt(0).toUpperCase();
    return { email: user.email, initials };
  }
}