/**
 * Credential validation for mobile login and sign-up forms.
 *
 * Pure function — no React Native imports. Mirrors the API-side validation
 * (email format, password min 8 chars) so the mobile app can give immediate
 * feedback before making a network request.
 */

export type CredentialValidationResult =
  | { valid: true; email: string; password: string }
  | { valid: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function validateCredentials(
  email: string,
  password: string
): CredentialValidationResult {
  const trimmedEmail = email.trim();

  if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
    return { valid: false, error: "Invalid email address" };
  }

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }

  return { valid: true, email: trimmedEmail, password };
}
