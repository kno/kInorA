import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchProfile } from "../auth/profile-client";

/**
 * /admin landing page — the admin backoffice access point (GH #306
 * foundation). Today the only way to reach `/admin/ai-config` was to type
 * the URL directly; this page gives admins a discoverable entry point that
 * lists every admin section, live or "coming soon".
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie.
 *  2. Resolves the authenticated profile via GET /auth/profile (the same
 *     endpoint the app shell layout already uses for sidebar identity —
 *     Slice this issue's Foundation step exposes `isAdmin` on it).
 *  3. Redirects to `/` when unauthenticated OR not an admin — mirroring the
 *     ai-config page's 401/403 → redirect("/") pattern so a non-admin is
 *     never shown this panel, never even the section list.
 *  4. Renders the section list for admins: AI Config (live, links to
 *     /admin/ai-config) plus Tenant Provisioning (#307), Platform Statistics
 *     (#309), and Logs/Observability (#310) as disabled "coming soon" cards.
 */
export default async function AdminPage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const profile = token ? await fetchProfile(token) : null;

  if (!profile || profile.isAdmin !== true) {
    redirect("/");
  }

  const sections: {
    key: string;
    href?: string;
    comingSoon?: boolean;
  }[] = [
    { key: "aiConfig", href: "/admin/ai-config" },
    { key: "tenantProvisioning", href: "/admin/tenants" },
    { key: "platformStatistics", comingSoon: true },
    { key: "logs", comingSoon: true },
  ];

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{t("admin.pageTitle")}</h1>
        <p className="kin-text kin-muted" style={{ marginBottom: "1.5rem" }}>
          {t("admin.pageDescription")}
        </p>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.75rem" }}>
          {sections.map((section) => {
            const title = t(`admin.sections.${section.key}.title`);
            const description = t(`admin.sections.${section.key}.description`);
            return (
              <li key={section.key} className="kin-card">
                {section.href ? (
                  <Link href={section.href}>
                    <strong>{title}</strong>
                    <p className="kin-muted">{description}</p>
                  </Link>
                ) : (
                  <div aria-disabled="true">
                    <strong>{title}</strong>
                    <p className="kin-muted">{description}</p>
                    <span className="kin-muted">{t("admin.comingSoon")}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
