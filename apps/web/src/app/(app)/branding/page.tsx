import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { EMPTY_PALETTE } from "./branding-constants";
import { fetchBranding } from "./branding-client";
import { BrandingStudio, type BrandingInitial } from "./BrandingStudio";

/**
 * Gym Branding Studio page — /branding (16a-v3-gym-white-label).
 *
 * Server component that:
 *  1. Reads the session token from the `kinora_session` cookie.
 *  2. Calls the gym-gated `GET /branding`. A missing token, a `403` (the
 *     tenant tier is not `gym`), or a `401` all redirect to `/dashboard` —
 *     a non-gym tenant must never see the studio.
 *  3. On `ok`, seeds the studio with the current branding. On `not_found`
 *     (a gym tenant that has not configured branding yet) it seeds empty
 *     defaults so the owner can create branding — that degrade is correct.
 *     On a transient `error` it ALSO seeds empty defaults (so the studio
 *     still renders), but renders a visible error banner and flags the
 *     studio via `loadFailed` so Save is disabled — collapsing a read
 *     failure into "no branding configured" would let an owner who already
 *     has a real subdomain/logo/palette save blank defaults over it
 *     (kno/kInorA#378).
 */
export default async function BrandingPage() {
  const t = await getTranslations("brandingStudio");
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (!token) {
    redirect("/dashboard");
  }

  const result = token ? await fetchBranding(token) : null;
  if (result && (result.kind === "forbidden" || result.kind === "unauthorized")) {
    redirect("/dashboard");
  }

  const loadFailed = result?.kind === "error";

  const initial: BrandingInitial =
    result && result.kind === "ok"
      ? {
          subdomainSlug: result.branding.subdomainSlug,
          logoUrl: result.branding.logoUrl,
          palette: result.branding.palette,
        }
      : { subdomainSlug: "", logoUrl: null, palette: EMPTY_PALETTE };

  return (
    <main className="kin-page">
      <div className="branding-studio-shell">
        <header className="branding-studio-head">
          <p className="branding-studio-eyebrow">{t("eyebrow")}</p>
          <h1 className="kin-title">{t("title")}</h1>
          <p className="kin-text kin-muted">{t("description")}</p>
        </header>
        {loadFailed && (
          <p className="kin-text" role="alert" data-testid="branding-load-error">
            {t("errors.loadFailed")}
          </p>
        )}
        <BrandingStudio initial={initial} loadFailed={loadFailed} />
      </div>
    </main>
  );
}
