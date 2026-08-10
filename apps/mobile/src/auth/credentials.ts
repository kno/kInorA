/**
 * Credential validation for mobile login and sign-up forms.
 *
 * Pure function — no React Native imports. Mirrors the API-side validation
 * (email format, password min 8 chars) so the mobile app can give immediate
 * feedback before making a network request.
 */

/**
 * Which check failed, so a caller can put the message under the field it is
 * about. Added for kno/kInorA#445: the Open Design screen `mobile-auth.html`
 * draws validation as an inline hint beneath the offending input rather than
 * as one modal alert. The rules, the order they run in and the `error` strings
 * below are unchanged — this only names the field the existing failure is
 * already about.
 */
export type CredentialField = "email" | "password";

export type CredentialValidationResult =
  | { valid: true; email: string; password: string }
  | { valid: false; field: CredentialField; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function validateCredentials(
  email: string,
  password: string
): CredentialValidationResult {
  const trimmedEmail = email.trim();

  if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
    return { valid: false, field: "email", error: "Invalid email address" };
  }

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      field: "password",
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }

  return { valid: true, email: trimmedEmail, password };
}
