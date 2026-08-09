import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchProfile } from "../../auth/profile-client";
import { fetchStats } from "./stats-client";
import { StatsView } from "./StatsView";
import { AdminPageShell } from "../AdminPageShell";
import styles from "../admin.module.css";

/**
 * Admin platform-statistics page — /admin/stats (GH #309).
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie.
 *  2. Resolves the profile via GET /auth/profile and redirects to `/` unless
 *     `isAdmin` — the SAME superadmin guard the /admin landing, /admin/tenants
 *     and /admin/logs pages use, so a non-admin never sees this panel.
 *  3. Fetches the cross-tenant aggregates server-side and renders the read-only
 *     StatsView, or a localized error message on any non-ok result.
 *
 * Layout follows the Open Design `web-admin-stats.html` screen
 * (kno/kInorA#414). The design's "Updated · <date>" pill and its "Refresh"
 * button are deliberately NOT rendered: the page carries no last-refreshed
 * timestamp, and a hardcoded date beside a button is precisely the defect
 * kno/kInorA#411 was raised for.
 */
export default async function AdminStatsPage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const profile = token ? await fetchProfile(token) : null;
  if (!profile || profile.isAdmin !== true) {
    redirect("/");
  }

  const result = await fetchStats(token);

  return (
    <AdminPageShell
      eyebrow={t("admin.sectionEyebrow")}
      title={t("platformStats.title")}
      description={t("platformStats.description")}
      backLabel={t("admin.pageTitle")}
    >
      {result.kind === "ok" ? (
        <StatsView stats={result.stats} />
      ) : (
        <section
          className={`${styles.panel} ${styles.state} ${styles.stateError}`}
          role="alert"
          data-testid="stats-error"
        >
          <div className={styles.eyebrow}>{t("platformStats.errorEyebrow")}</div>
          <p>{t("platformStats.error")}</p>
        </section>
      )}
    </AdminPageShell>
  );
}
