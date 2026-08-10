import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getFirstParam } from "@/i18n/request";
import { loginAction } from "./actions";
import { extractGymSlugFromHost } from "@/lib/gym-slug";
import { fetchPublicBranding } from "@/lib/gym-branding-client";
import { buildGymStyleBlock } from "@/lib/gym-style";
import { OrbitLogoIcon } from "@/components/icons";
import { AuthSubmitButton } from "../AuthSubmitButton";
import styles from "../auth.module.css";

/**
 * Login page — email/password form + "Sign in with Google" link.
 *
 * On submit, the form posts to the `loginAction` Server Action which calls
 * the API `POST /auth/login`, stores the opaque session token in the
 * `kinora_session` cookie, and redirects to the app home. The Google link
 * hits the web social-login proxy (`/auth/social/login?provider=google`)
 * which redirects the user-agent to Google's OIDC authorization URL.
 *
 * User-facing copy comes from next-intl (see `@/i18n/request`), whose locale is
 * resolved from the `?lang=` query parameter (via the `x-kinora-lang`
 * header injected by `proxy.ts`) or the `Accept-Language` header.
 *
 * kno/kInorA#445 — built to the Open Design screen `web-login.html`: brand row,
 * display-scale title and supporting line, labelled fields, the separator and
 * ghost Google button, and the "El plan se adapta." poster beside the form.
 * Styling lives in the colocated `auth.module.css`, matching the convention
 * `/plan`, `/plans`, `/stats` and `/admin` already follow. This is presentation
 * only: the action, the redirects, the validation attributes and the `?error=`
 * semantics are untouched.
 *
 * Two things the screen depicts are deliberately NOT here, because shipping
 * them would mean shipping a control that does nothing:
 *   - the "¿La olvidaste?" password-reset link — the product has no
 *     password-reset route and the API has no reset endpoint;
 *   - the white-label variant's "Entrena con <gym> · impulsado por kInorA"
 *     footer — `PublicBrandingDTO` carries a logo and a palette, not a gym
 *     name, so the gym's name is not available to render.
 * Both are reported on the issue rather than invented here.
 *
 * 16a-v3-gym-white-label, Slice 4: pre-auth gym white-label theming. The
 * request `Host` header is resolved to a `subdomainSlug` server-side
 * (`gym-slug.ts`, Node runtime — this Server Component never sends the
 * host to the client), then the PUBLIC S3 read-by-slug endpoint is
 * fetched (`gym-branding-client.ts`). When branding is found, its palette
 * is injected as a server-rendered inline `<style>` block setting the
 * `--gym-*` custom properties on `:root` (see `gym-style.ts` and
 * `globals.css`'s `var(--gym-x, var(--default))` fallbacks — no JS
 * branching, mirrors 15b's `--plan-accent` pattern) and its logo renders in
 * the brand row in place of the kInorA mark. No slug, an unknown slug (404),
 * or a failed fetch all fall back to the unmodified default page.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const error = getFirstParam(params.error);
  const t = await getTranslations();

  const requestHeaders = await headers();
  const gymSlug = extractGymSlugFromHost(requestHeaders.get("host"));
  const branding = gymSlug ? await fetchPublicBranding(gymSlug) : null;

  return (
    <main className="kin-page">
      {branding ? <style>{buildGymStyleBlock(branding.palette)}</style> : null}

      <div className={styles.stage}>
        <div className={styles.card}>
          <div className={styles.brand}>
            {branding?.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={t("auth.login.gymLogoAlt")}
                className={styles.gymLogo}
              />
            ) : (
              <>
                <OrbitLogoIcon size={32} decorative />
                <span className={styles.brandName}>{t("marketing.title")}</span>
              </>
            )}
          </div>

          <h1 className={styles.title}>{t("auth.login.title")}</h1>
          <p className={styles.subtitle}>{t("auth.login.subtitle")}</p>

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

          <form action={loginAction} className={styles.form}>
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
                autoComplete="current-password"
                className={styles.input}
              />
            </label>

            <AuthSubmitButton
              className={styles.submit}
              spinnerClassName={styles.spinner}
              pendingLabel={t("auth.login.pending")}
            >
              {t("auth.login.submit")}
            </AuthSubmitButton>

            <div className={styles.separator}>{t("auth.separator")}</div>

            {/*
              Inside the <form> so the submitting state reaches it: the screen
              greys the Google button while a submission is in flight, and the
              module does that with `:has()` scoped to the form. An anchor is
              valid form content and this stays a plain navigation.
            */}
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
              {t("auth.login.google")}
            </a>
          </form>

          <p className={styles.foot}>
            {t("auth.login.switchPrompt")}{" "}
            <a href="/sign-up" className={styles.footLink}>
              {t("auth.login.switchLink")}
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
            {t("auth.login.poster.badge")}
          </span>

          <h2 className={styles.posterTitle}>{t("auth.login.poster.title")}</h2>
          <p className={styles.posterBody}>{t("auth.login.poster.body")}</p>

          {/*
            Static product copy, not rendered data: the catalog these figures
            describe ships in-repo (`packages/exercise-catalog`, 1324 entries),
            and none of the three reads from a user's account. Nothing here is
            a per-user number the way #411's readiness score was.
          */}
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <b className={styles.statValue}>
                {t("auth.login.poster.stat1.value")}
              </b>
              <span className={styles.statLabel}>
                {t("auth.login.poster.stat1.label")}
              </span>
            </div>
            <div className={styles.stat}>
              <b className={styles.statValue}>
                {t("auth.login.poster.stat2.value")}
              </b>
              <span className={styles.statLabel}>
                {t("auth.login.poster.stat2.label")}
              </span>
            </div>
            <div className={styles.stat}>
              <b className={styles.statValue}>
                {t("auth.login.poster.stat3.value")}
              </b>
              <span className={styles.statLabel}>
                {t("auth.login.poster.stat3.label")}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
