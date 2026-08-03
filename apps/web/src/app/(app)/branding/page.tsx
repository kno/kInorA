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
 *  3. On `ok`, seeds the studio with the current branding; on `not_found`
 *     (a gym tenant that has not configured branding yet) or a transient
 *     error, seeds it with empty defaults so the owner can create branding.
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
        <BrandingStudio initial={initial} />
      </div>
    </main>
  );
}
