/**
 * Wiring: assemble a production {@link SocialAuthService} from a Database +
 * {@link ProviderRegistry}. Keeps drizzle-bound repository construction out of
 * the pure `social.ts` service (architecture: db access lives in the infra
 * layer; this factory wires infra to the service ports).
 */
import type { Database } from "../db/client.js";
import { provisionTenantForUser, linkOauthToExistingUser } from "../tenant/provisioning.js";
import { OauthAccountRepository } from "../db/repositories/oauth-accounts.js";
import { SocialContextRepository } from "../db/repositories/social-context.js";
import { SessionRepository } from "../db/repositories/session.js";
import { SocialAuthService, type ProviderRegistry } from "./social.js";

/**
 * Derive a default personal-workspace tenant name from the email local part.
 * Mirrors AuthService (PR2); consolidate on merge.
 */
function deriveTenantName(email: string): string {
  const localPart = email.split("@")[0];
  return localPart ? `${localPart}'s workspace` : "My workspace";
}

/**
 * Build a {@link SocialAuthService} backed by real Drizzle repositories.
 */
export function createSocialAuthService(
  db: Database,
  registry: ProviderRegistry
): SocialAuthService {
  const oauthRepo = new OauthAccountRepository(db);
  const contextRepo = new SocialContextRepository(db);
  const sessionRepo = new SessionRepository(db);

  return new SocialAuthService({
    registry,
    findUserByEmail: (email) => contextRepo.findUserByEmail(email),
    findOauthByProviderAccount: (providerId, providerAccountId) =>
      oauthRepo.findByProviderAccount(providerId, providerAccountId),
    findMembershipByUserId: (userId) =>
      contextRepo.findMembershipByUserId(userId),
    findTenantById: (id) => contextRepo.findTenantById(id),
    provisionNewGoogleOnlyUser: async (providerId, providerAccountId, email) => {
      const tenantName = deriveTenantName(email);
      const provisioned = await provisionTenantForUser(db, {
        tenantName,
        userEmail: email,
      });
      await oauthRepo.create({
        providerId,
        providerAccountId,
        email,
        userId: provisioned.userId,
      });
      return {
        userId: provisioned.userId,
        tenantId: provisioned.tenantId,
        tenantName,
      };
    },
    linkOauthToExistingUser: (userId, providerId, providerAccountId, email) =>
      linkOauthToExistingUser(db, userId, providerId, providerAccountId, email),
    createSession: (input) => sessionRepo.create(input).then(() => undefined),
  });
}