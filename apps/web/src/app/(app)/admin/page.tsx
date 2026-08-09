import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchProfile } from "../auth/profile-client";
import { AdminPageShell } from "./AdminPageShell";
import styles from "./admin.module.css";

/**
 * /admin landing page — the admin backoffice access point (GH #306
 * foundation). Today the only way to reach `/admin/ai-config` was to type
 * the URL directly; this page gives admins a discoverable entry point that
 * lists every admin section.
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie.
 *  2. Resolves the authenticated profile via GET /auth/profile (the same
 *     endpoint the app shell layout already uses for sidebar identity).
 *  3. Redirects to `/` when unauthenticated OR not an admin — mirroring the
 *     ai-config page's 401/403 → redirect("/") pattern so a non-admin is
 *     never shown this panel, never even the section list.
 *  4. Renders the four live section cards.
 *
 * Styling follows the Open Design `web-admin.html` screen (kno/kInorA#414).
 * That screen also shows a live datum on each card (active provider, tenant
 * count, error count). Those are NOT rendered here: this page fetches only the
 * profile, so any figure would be decoration presented as data — exactly the
 * defect kno/kInorA#411 was raised for. The cards state what they open, and
 * nothing they cannot substantiate.
 */
export default async function AdminPage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const profile = token ? await fetchProfile(token) : null;

  if (!profile || profile.isAdmin !== true) {
    redirect("/");
  }

  const sections: { key: string; href: string }[] = [
    { key: "aiConfig", href: "/admin/ai-config" },
    { key: "tenantProvisioning", href: "/admin/tenants" },
    { key: "platformStatistics", href: "/admin/stats" },
    { key: "logs", href: "/admin/logs" },
  ];

  return (
    <AdminPageShell
      eyebrow={t("admin.eyebrow")}
      title={t("admin.pageTitle")}
      description={t("admin.pageDescription")}
    >
      <p className={`${styles.banner} ${styles.bannerInfo}`}>
        <span>
          <b>{t("admin.notice.title")}</b>
          {t("admin.notice.body")}
        </span>
      </p>

      <ul className={styles.accessGrid}>
        {sections.map((section) => (
          <li key={section.key} className={styles.panel}>
            <Link href={section.href} className={styles.access}>
              <span className={styles.accessTitle}>
                {t(`admin.sections.${section.key}.title`)}
              </span>
              <span className={styles.accessDesc}>
                {t(`admin.sections.${section.key}.description`)}
              </span>
              <span className={styles.accessGo}>{t("admin.open")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </AdminPageShell>
  );
}
