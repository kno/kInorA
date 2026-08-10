import { getTranslations } from "next-intl/server";
import { getFirstParam } from "@/i18n/request";
import { signupAction } from "./actions";
import { OrbitLogoIcon } from "@/components/icons";
import { AuthSubmitButton } from "../AuthSubmitButton";
import styles from "../auth.module.css";

/**
 * Sign-up page — email/password form + "Sign up with Google" link.
 *
 * On submit, the form posts to the `signupAction` Server Action which calls
 * the API `POST /auth/register`, stores the session token, and redirects
 * home. The Google link hits the social-login proxy.
 *
 * User-facing copy comes from next-intl (see `@/i18n/request`), whose
 * locale is resolved from the `?lang=` query parameter (via the
 * `x-kinora-lang` header injected by `proxy.ts`) or the `Accept-Language`
 * header.
 *
 * kno/kInorA#445 — built to the Open Design screen `web-sign-up.html`, sharing
 * `auth.module.css` with the login page: the two screens are one visual system,
 * differing only in copy and in the supporting panel ("Cuéntanos tu objetivo."
 * with the three onboarding steps, rather than login's stat row). Presentation
 * only — the action, the redirects, the validation attributes and the `?error=`
 * semantics are untouched.
 *
 * The screen's password-strength meter is deliberately NOT here. It grades a
 * password as the user types, which is a client-side validation rule this form
 * does not have and which the API does not expose; adding one inside a restyle
 * would change what the form accepts and what it tells the user before submit.
 * Reported on the issue instead. The screen's "Mínimo 8 caracteres" password
 * placeholder IS shipped: it states the rule the API already enforces.
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
      <div className={styles.stage}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <OrbitLogoIcon size={32} decorative />
            <span className={styles.brandName}>{t("marketing.title")}</span>
          </div>

          <h1 className={styles.title}>{t("auth.signup.title")}</h1>
          <p className={styles.subtitle}>{t("auth.signup.subtitle")}</p>

          {error ? (
            <p role="alert" className={styles.banner}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={styles.bannerIcon}
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16.5v.01" />
              </svg>
              {error}
            </p>
          ) : null}

          <form action={signupAction} className={styles.form}>
            <label className={styles.field} data-invalid={error ? "" : undefined}>
              <span className={styles.label}>{t("auth.emailLabel")}</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder={t("auth.emailPlaceholder")}
                className={styles.input}
              />
            </label>

            <label className={styles.field} data-invalid={error ? "" : undefined}>
              <span className={styles.label}>{t("auth.passwordLabel")}</span>
              <input
                name="password"
                type="password"
                required
                autoComplete="new-password"
                placeholder={t("auth.passwordPlaceholder")}
                className={styles.input}
              />
            </label>

            <AuthSubmitButton
              className={styles.submit}
              spinnerClassName={styles.spinner}
              pendingLabel={t("auth.signup.pending")}
            >
              {t("auth.signup.submit")}
            </AuthSubmitButton>

            <div className={styles.separator}>{t("auth.separator")}</div>

            {/* Inside the <form> for the same reason as on /login — see there. */}
            <a
              href="/auth/social/login?provider=google"
              className={styles.google}
            >
              <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 14 17.6 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.6-4.8 7.3l7.6 5.9c4.4-4.1 7-10.1 7-17.5z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.4 28.4a14.6 14.6 0 010-8.6l-7.8-6.1a23.5 23.5 0 000 20.8l7.8-6.1z"
                />
                <path
                  fill="#34A853"
                  d="M24 47.5c6.2 0 11.5-2 15.5-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.9 2.3-6.4 0-11.7-4.5-13.6-10.3l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z"
                />
              </svg>
              {t("auth.signup.google")}
            </a>
          </form>

          <p className={styles.foot}>
            {t("auth.signup.switchPrompt")}{" "}
            <a href="/login" className={styles.footLink}>
              {t("auth.signup.switchLink")}
            </a>
          </p>
        </div>

        <aside className={styles.poster}>
          <span className={styles.posterBadge}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
            </svg>
            {t("auth.signup.poster.badge")}
          </span>

          <h2 className={styles.posterTitle}>{t("auth.signup.poster.title")}</h2>
          <p className={styles.posterBody}>{t("auth.signup.poster.body")}</p>

          <ol className={styles.steps}>
            <li className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                1
              </span>
              <p className={styles.stepTitle}>
                {t("auth.signup.poster.step1.title")}
                <span className={styles.stepDesc}>
                  {t("auth.signup.poster.step1.desc")}
                </span>
              </p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                2
              </span>
              <p className={styles.stepTitle}>
                {t("auth.signup.poster.step2.title")}
                <span className={styles.stepDesc}>
                  {t("auth.signup.poster.step2.desc")}
                </span>
              </p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                3
              </span>
              <p className={styles.stepTitle}>
                {t("auth.signup.poster.step3.title")}
                <span className={styles.stepDesc}>
                  {t("auth.signup.poster.step3.desc")}
                </span>
              </p>
            </li>
          </ol>
        </aside>
      </div>
    </main>
  );
}
