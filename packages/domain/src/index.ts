/**
 * Domain package — inner use-case and entity layer.
 *
 * This package depends ONLY on @kinora/contracts.
 * No framework, database, or infrastructure imports allowed.
 */

export { createPlanDraft } from "./plan/plan-draft.js";
export type { PlanDraft } from "./plan/plan-draft.js";

export {
  MIN_PASSWORD_LENGTH,
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  PasswordPolicyError,
  type ScryptOptions,
} from "./auth/password.js";

export {
  TOKEN_BYTES,
  TOKEN_HEX_LENGTH,
  isValidTokenFormat,
  assertValidToken,
  isSessionExpired,
  assertSessionNotExpired,
  InvalidSessionTokenError,
} from "./auth/session.js";