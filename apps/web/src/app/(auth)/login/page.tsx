import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getFirstParam } from "@/i18n/request";
import { loginAction } from "./actions";
import { extractGymSlugFromHost } from "./gym-slug";
import { fetchPublicBranding } from "./gym-branding-client";
import { buildGymStyleBlock } from "@/lib/gym-style";

/**
 * Login page — email/password form + "Sign in with Google" link.
 *
 * On submit, the form posts to the `loginAction` Server Action which calls
 * the API `POST /auth/login`, stores the opaque session token in the
 * `kinora_session` cookie, and redirects to the app home. The Google link
 * hits the web social-login proxy (`/auth/social/login?provider=google`)
 * which redirects the user-agent to Google's OIDC authorization URL.
 *
 * Styled with the kInorA design-system tokens (globals.css). User-facing
 * copy comes from next-intl (see `@/i18n/request`), whose locale is
 * resolved from the `?lang=` query parameter (via the `x-kinora-lang`
 * header injected by `proxy.ts`) or the `Accept-Language` header.
 *
 * 16a-v3-gym-white-label, Slice 4: pre-auth gym white-label theming. The
 * request `Host` header is resolved to a `subdomainSlug` server-side
 * (`gym-slug.ts`, Node runtime — this Server Component never sends the
 * host to the client), then the PUBLIC S3 read-by-slug endpoint is
 * fetched (`gym-branding-client.ts`). When branding is found, its palette
 * is injected as a server-rendered inline `<style>` block setting the
 * `--gym-*` custom properties on `:root` (see `gym-style.ts` and
 * `globals.css`'s `var(--gym-x, var(--default))` fallbacks — no JS
 * branching, mirrors 15b's `--plan-accent` pattern) and its logo renders.
 * No slug, an unknown slug (404), or a failed fetch all fall back to the
 * unmodified default page — a normal (non-gym) visit renders byte-identical
 * to before this slice.
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
      <div className="kin-card">
        {branding?.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt={t("auth.login.gymLogoAlt")}
            className="kin-login-logo"
          />
        ) : null}

        <h1 className="kin-title kin-title--center">{t("auth.login.title")}</h1>

        {error ? (
          <p role="alert" className="kin-error">
            {error}
          </p>
        ) : null}

        <form action={loginAction} className="kin-form">
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
              autoComplete="current-password"
              className="kin-input"
            />
          </label>

          <button type="submit" className="kin-btn kin-btn--accent">
            {t("auth.login.submit")}
          </button>
        </form>

        <a
          href="/auth/social/login?provider=google"
          className="kin-btn kin-btn--ghost"
        >
          {t("auth.login.google")}
        </a>

        <p className="kin-switch">
          {t("auth.login.switchPrompt")}{" "}
          <a href="/sign-up" className="kin-switch-link">
            {t("auth.login.switchLink")}
          </a>
        </p>
      </div>
    </main>
  );
}
