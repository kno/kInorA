import { getFirstParam, resolvePageI18n } from "@/i18n/request";
import { loginAction } from "./actions";

/**
 * Login page — email/password form + "Sign in with Google" link.
 *
 * On submit, the form posts to the `loginAction` Server Action which calls
 * the API `POST /auth/login`, stores the opaque session token in the
 * `kinora_session` cookie, and redirects to the app home. The Google link
 * hits the web social-login proxy (`/auth/social/login?provider=google`)
 * which redirects the user-agent to Google's OIDC authorization URL.
 *
 * Styled with the kInorA design-system tokens (globals.css). User-facing copy
 * comes from the i18n catalogs (see `@/i18n/locale`), resolved from the
 * `?lang=` query parameter or the `Accept-Language` header.
 */
export default async function LoginPage({
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
        <h1 className="kin-title kin-title--center">{messages.auth_login_title}</h1>

        {error ? (
          <p role="alert" className="kin-error">
            {error}
          </p>
        ) : null}

        <form action={loginAction} className="kin-form">
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
              autoComplete="current-password"
              className="kin-input"
            />
          </label>

          <button type="submit" className="kin-btn kin-btn--accent">
            {messages.auth_login_submit}
          </button>
        </form>

        <a
          href="/auth/social/login?provider=google"
          className="kin-btn kin-btn--ghost"
        >
          {messages.auth_login_google}
        </a>

        <p className="kin-switch">
          {messages.auth_login_switch_prompt}{" "}
          <a href="/sign-up" className="kin-switch-link">
            {messages.auth_login_switch_link}
          </a>
        </p>
      </div>
    </main>
  );
}
