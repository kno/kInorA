import { getTranslations } from "next-intl/server";
import { getFirstParam } from "@/i18n/request";
import { signupAction } from "./actions";

/**
 * Sign-up page — email/password form + "Sign up with Google" link.
 *
 * On submit, the form posts to the `signupAction` Server Action which calls
 * the API `POST /auth/register`, stores the session token, and redirects
 * home. The Google link hits the social-login proxy. Mirrors the login page
 * layout and styling.
 *
 * User-facing copy comes from next-intl (see `@/i18n/request`), whose
 * locale is resolved from the `?lang=` query parameter (via the
 * `x-kinora-lang` header injected by `proxy.ts`) or the `Accept-Language`
 * header.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const error = getFirstParam(params.error);
  const t = await getTranslations();

  return (
    <main className="kin-page">
      <div className="kin-card">
        <h1 className="kin-title kin-title--center">{t("auth.signup.title")}</h1>

        {error ? (
          <p role="alert" className="kin-error">
            {error}
          </p>
        ) : null}

        <form action={signupAction} className="kin-form">
          <label className="kin-field">
            <span className="kin-label">{t("auth.emailLabel")}</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="kin-input"
            />
          </label>

          <label className="kin-field">
            <span className="kin-label">{t("auth.passwordLabel")}</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="new-password"
              className="kin-input"
            />
          </label>

          <button type="submit" className="kin-btn kin-btn--accent">
            {t("auth.signup.submit")}
          </button>
        </form>

        <a
          href="/auth/social/login?provider=google"
          className="kin-btn kin-btn--ghost"
        >
          {t("auth.signup.google")}
        </a>

        <p className="kin-switch">
          {t("auth.signup.switchPrompt")}{" "}
          <a href="/login" className="kin-switch-link">
            {t("auth.signup.switchLink")}
          </a>
        </p>
      </div>
    </main>
  );
}
