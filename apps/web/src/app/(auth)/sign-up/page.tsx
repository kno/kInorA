import { getFirstParam, resolvePageI18n } from "@/i18n/request";
import { signupAction } from "./actions";

/**
 * Sign-up page — email/password form + "Sign up with Google" link.
 *
 * On submit, the form posts to the `signupAction` Server Action which calls
 * the API `POST /auth/register`, stores the session token, and redirects
 * home. The Google link hits the social-login proxy. Mirrors the login page
 * layout and styling.
 *
 * User-facing copy comes from the i18n catalogs (see `@/i18n/locale`),
 * resolved from the `?lang=` query parameter or the `Accept-Language` header.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const error = getFirstParam(params.error);
  const { messages } = await resolvePageI18n(getFirstParam(params.lang));

  return (
    <main className="kin-page">
      <div className="kin-card">
        <h1 className="kin-title kin-title--center">{messages.auth_signup_title}</h1>

        {error ? (
          <p role="alert" className="kin-error">
            {error}
          </p>
        ) : null}

        <form action={signupAction} className="kin-form">
          <label className="kin-field">
            <span className="kin-label">{messages.auth_email_label}</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="kin-input"
            />
          </label>

          <label className="kin-field">
            <span className="kin-label">{messages.auth_password_label}</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="new-password"
              className="kin-input"
            />
          </label>

          <button type="submit" className="kin-btn kin-btn--accent">
            {messages.auth_signup_submit}
          </button>
        </form>

        <a
          href="/auth/social/login?provider=google"
          className="kin-btn kin-btn--ghost"
        >
          {messages.auth_signup_google}
        </a>

        <p className="kin-switch">
          {messages.auth_signup_switch_prompt}{" "}
          <a href="/login" className="kin-switch-link">
            {messages.auth_signup_switch_link}
          </a>
        </p>
      </div>
    </main>
  );
}
